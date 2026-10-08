-- 拆细游戏与应用二级分类。只迁移原有宽分类，避免覆盖已经人工修改的新分类。
update public.keyword_volume
set content_subcategory = case
  when content_subcategory = '仙侠手游' and keyword ~* '(武侠|江湖|门派)' then '武侠'
  when content_subcategory = '仙侠手游' then '仙侠'
  when content_subcategory = '休闲手游' and keyword ~* '(益智|脑力|烧脑)' then '益智'
  when content_subcategory = '休闲手游' then '休闲'
  when content_subcategory = '射击手游' then '射击'
  when content_subcategory = '回合手游' then '回合'
  when content_subcategory = '卡牌放置' and keyword ~* '(放置|挂机)' then '放置'
  when content_subcategory = '卡牌放置' then '卡牌'
  when content_subcategory = '传奇手游' then '传奇'
  when content_subcategory = '解谜手游' then '解谜'
  when content_subcategory = '三国手游' then '三国'
  when content_subcategory = '动作冒险' and keyword ~* '(冒险|探险|探索)' then '冒险'
  when content_subcategory = '动作冒险' then '动作'
  when content_subcategory = '经营模拟' and keyword ~* '(经营|开店|餐厅|农场|庄园|公司|商业)' then '经营'
  when content_subcategory = '经营模拟' then '模拟'
  when content_subcategory = '塔防手游' then '塔防'
  when content_subcategory = '竞速手游' then '竞速'
  when content_subcategory = '体育手游' then '体育'
  when content_subcategory = '节奏手游' then '音乐节奏'
  when content_subcategory = '手游盒子' then '游戏盒子'
  else content_subcategory
end
where content_category = '游戏'
  and content_subcategory in (
    '仙侠手游', '休闲手游', '射击手游', '回合手游', '卡牌放置', '传奇手游',
    '解谜手游', '三国手游', '动作冒险', '经营模拟', '塔防手游', '竞速手游',
    '体育手游', '节奏手游', '手游盒子'
  );

update public.keyword_volume
set content_subcategory = case
  when content_subcategory = '社交聊天' and keyword ~* '(聊天|即时通讯|交友聊天)' then '聊天'
  when content_subcategory = '社交聊天' then '社交'
  when content_subcategory = '美食菜谱' and keyword ~* '(菜谱|食谱|做菜)' then '菜谱'
  when content_subcategory = '美食菜谱' then '美食'
  when content_subcategory = '音乐软件' then '音乐'
  when content_subcategory = '影视软件' and keyword ~* '(直播|主播|电视直播)' then '直播'
  when content_subcategory = '影视软件' and keyword ~* '(短视频|抖音|快手)' then '短视频'
  when content_subcategory = '影视软件' then '影视'
  when content_subcategory = '办公工具' then '办公'
  when content_subcategory = '手机购物' then '购物'
  when content_subcategory = '拍摄滤镜' and keyword ~* '(滤镜|修图|p图)' then '滤镜'
  when content_subcategory = '拍摄滤镜' then '摄影'
  when content_subcategory = '手机阅读' and keyword ~* '(漫画|动漫阅读)' then '漫画'
  when content_subcategory = '手机阅读' and keyword ~* '(小说|网文)' then '小说'
  when content_subcategory = '手机阅读' then '阅读'
  when content_subcategory = '教育软件' then '教育'
  when content_subcategory = '母婴育儿' and keyword ~* '(育儿|早教|宝宝)' then '育儿'
  when content_subcategory = '母婴育儿' then '母婴'
  when content_subcategory = '手机工具' and keyword ~* '(输入法|键盘皮肤)' then '输入法'
  when content_subcategory = '手机工具' and keyword ~* '(文件管理|文件夹|解压|压缩文件)' then '文件管理'
  when content_subcategory = '手机工具' and keyword ~* '(杀毒|安全软件|清理垃圾|手机清理|清理大师|加速清理)' then '安全清理'
  when content_subcategory = '手机工具' and keyword ~* '(下载器|下载工具|磁力下载|种子下载)' then '下载工具'
  when content_subcategory = '手机工具' and keyword ~* '(扫描识别|文字识别|ocr|扫码工具|二维码扫描)' then '扫描识别'
  when content_subcategory = '手机工具' and keyword ~* '(计算器|单位换算|汇率换算)' then '计算工具'
  when content_subcategory = '手机工具' and keyword ~* '(日历|万年历|闹钟|倒计时)' then '日历闹钟'
  when content_subcategory = '手机工具' and keyword ~* '(录音|录音机|语音记录)' then '录音工具'
  when content_subcategory = '手机工具' and keyword ~* '(翻译|词典|字典)' then '翻译工具'
  when content_subcategory = '手机工具' and keyword ~* '(系统工具|系统管理|手机系统)' then '系统工具'
  when content_subcategory = '手机工具' then '实用工具'
  when content_subcategory = '旅行酒店' and keyword ~* '(酒店|住宿|民宿)' then '酒店'
  when content_subcategory = '旅行酒店' then '旅行'
  when content_subcategory = '出行导航' and keyword ~* '(地图|导航|路线规划)' then '导航'
  when content_subcategory = '出行导航' then '出行'
  when content_subcategory = '健康软件' then '健康'
  when content_subcategory = '便捷生活' then '生活'
  else content_subcategory
end
where content_category = '应用'
  and content_subcategory in (
    '社交聊天', '美食菜谱', '音乐软件', '影视软件', '办公工具', '手机购物',
    '拍摄滤镜', '手机阅读', '教育软件', '母婴育儿', '手机工具', '旅行酒店',
    '出行导航', '健康软件', '便捷生活'
  );

-- 对所有旧分类补充识别意图非常明确的新类别；顺序从专用类别到通用类别。
update public.keyword_volume
set content_subcategory = case
  when keyword ~* '(武侠|江湖|门派)' then '武侠'
  when keyword ~* '(moba|5v5|多人在线战术竞技|王者荣耀|英雄联盟手游)' then 'MOBA'
  when keyword ~* '(沙盒|像素沙盒)' then '沙盒'
  when keyword ~* '(益智|脑力|烧脑)' then '益智'
  when keyword ~* '(养成|育成)' then '养成'
  else content_subcategory
end
where content_category = '游戏'
  and keyword ~* '(武侠|江湖|门派|moba|5v5|多人在线战术竞技|王者荣耀|英雄联盟手游|沙盒|像素沙盒|益智|脑力|烧脑|养成|育成)';

update public.keyword_volume
set content_subcategory = case
  when keyword ~* '(直播|主播|电视直播)' then '直播'
  when keyword ~* '(短视频|抖音|快手)' then '短视频'
  when keyword ~* '(运动健身|健身|跑步|瑜伽|计步|减肥运动)' then '运动健身'
  when keyword ~* '(招聘|求职|找工作|人才网)' then '招聘求职'
  when keyword ~* '(天气|气象|天气预报)' then '天气'
  when keyword ~* '(新闻|资讯|头条)' then '新闻'
  else content_subcategory
end
where content_category = '应用'
  and keyword ~* '(直播|主播|电视直播|短视频|抖音|快手|运动健身|健身|跑步|瑜伽|计步|减肥运动|招聘|求职|找工作|人才网|天气|气象|天气预报|新闻|资讯|头条)';
