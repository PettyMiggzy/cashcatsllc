import { createTheme } from '@mui/material/styles'

// CashCats HQ palette — matches cashcatllc.help's dark filing/ticker identity.
const muiTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#e8b23c', // gold
    },
    secondary: {
      main: '#3ea877', // green
    },
    background: {
      default: '#0a1a14',
      paper: '#12241c',
    },
  },
})

export default muiTheme
