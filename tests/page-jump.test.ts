import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import ts from 'typescript'
import {resolvePageJump,validPageCount} from '../lib/page-jump'

test('page jump accepts full-width/pasted integers and reaches deep pages',()=>{
  assert.equal(resolvePageJump('10234',12000),10234)
  assert.equal(resolvePageJump(' ３０１ ',400),301)
  assert.equal(resolvePageJump('00012',20),12)
})
test('page jump clamps only valid integers to the available range',()=>{
  assert.equal(resolvePageJump('0',200),1)
  assert.equal(resolvePageJump('9999',200),200)
  assert.equal(resolvePageJump('9'.repeat(400),200),200)
  for(const value of ['', ' ', '-1', '+3', '1.5', '1e2', 'abc', '10x', 'NaN', 'Infinity']) assert.equal(resolvePageJump(value,200),null)
})
test('missing/single/invalid totals cannot produce a negative or nonfinite page',()=>{
  for(const total of [0,-10,1,NaN,Infinity]){
    assert.equal(validPageCount(total),1)
    assert.equal(resolvePageJump('42',total),1)
  }
  assert.equal(validPageCount(8.9),8)
})

test('every live pager adapter preserves its zero/one-based convention and query context',()=>{
  const files=['components','app/(dashboard)'].flatMap(root=>readdirSync(root,{recursive:true})
    .filter(name=>String(name).endsWith('.tsx')).map(name=>`${root}/${String(name).replaceAll('\\','/')}`))
  let direct=0,shared=0
  for(const file of files){
    const text=readFileSync(file,'utf8')
    if(!text.includes('<PageNumberInput')&&!text.includes('<SimplePagination'))continue
    const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
    const visit=(node:ts.Node)=>{
      if(ts.isJsxSelfClosingElement(node)&&['PageNumberInput','SimplePagination'].includes(node.tagName.getText(source))){
        const kind=node.tagName.getText(source),calls:{name:string;args:unknown[]}[]=[]
        const scope:Record<string,unknown>={React:{createElement:(_type:unknown,props:unknown)=>({props})},PageNumberInput:()=>null,SimplePagination:()=>null,
          page:6,item:6,safePage:6,searchPage:6,oPage:6,subPage:6,sourceDetailPage:6,detailPage:6,historyPage:6,messagePage:6,
          clampedPage:6,clampedListPage:6,clampedCoveragePage:6,mainPage:6,totalPages:900,pages:900,oTotalPages:900,
          sourceDetailTotalPages:900,detailTotalPages:900,historyPages:900,total:18000,historyTotal:18000,messageTotal:18000,
          sortedVisible:{length:18000},sortedDisplay:{length:18000},filteredGroups:{length:18000},filteredCoverage:{length:18000},
          pageSize:20,PAGE_SIZE:20,loading:false,disabled:false,historyLoading:false,messageLoading:false,
          discussionItem:{id:'discussion'},lookupUrl:'https://example.com/page',searchQuery:'original query'}
        for(const name of ['onChange','onPage','onPageChange','setPage','setOPage','setSubPage','setSourceDetailPage','setDetailPage',
          'setHistoryPage','setMainPage','setListPage','setCoveragePage','loadMessages','handleSearch','doSearch','lookup']){
          scope[name]=(...args:unknown[])=>{calls.push({name,args})}
        }
        // Evaluate only checked-in JSX props/callbacks, never external/user input.
        const js=ts.transpileModule(`const result=${node.getText(source)}`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText
        const props=Function('scope',`with(scope){${js};return result.props;}`)(scope) as {page:number;onChange:(n:number)=>void}
        const pageAttr=node.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(source)==='page') as ts.JsxAttribute
        const expression=pageAttr.initializer?.getText(source)??''
        props.onChange(42)
        assert.equal(calls.length,1,`${file}: one page jump must invoke one existing action`)
        const call=calls[0]
        const expected=kind==='PageNumberInput' ? (/\+\s*1/.test(expression)?41:42) : (/-\s*1/.test(expression)?43:42)
        assert.equal(call.args[['loadMessages','doSearch'].includes(call.name)?1:0],expected,`${file}: ${node.getText(source)}`)
        if(call.name==='lookup')assert.equal(call.args[1],scope.lookupUrl)
        if(call.name==='doSearch')assert.equal(call.args[0],scope.searchQuery)
        if(call.name==='loadMessages')assert.equal(call.args[0],'discussion')
        if(kind==='PageNumberInput')direct++;else shared++
      }
      ts.forEachChild(node,visit)
    }
    visit(source)
  }
  assert.ok(direct>=19,'all independent page/dialog pagers must use the shared input')
  assert.ok(shared>=14,'shared pagination consumers must retain their paging adapters')
})
