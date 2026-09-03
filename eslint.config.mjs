import nextVitals from 'eslint-config-next/core-web-vitals'

const config = [
  ...nextVitals,
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      'react/no-unescaped-entities': 'off',
      // These React 19 compiler-oriented rules require a broad component
      // architecture migration. Keep the established runtime patterns linted
      // by exhaustive-deps while handling that migration separately.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**'],
  },
]

export default config
