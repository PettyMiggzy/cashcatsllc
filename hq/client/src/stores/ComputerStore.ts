import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

interface ComputerState {
  computerDialogOpen: boolean
  computerId: null | string
}

const initialState: ComputerState = {
  computerDialogOpen: false,
  computerId: null,
}

export const computerSlice = createSlice({
  name: 'computer',
  initialState,
  reducers: {
    openComputerDialog: (
      state,
      action: PayloadAction<{ computerId: string; myUserId: string }>
    ) => {
      const game = phaserGame.scene.keys.game as Game
      game.disableKeys()
      state.computerDialogOpen = true
      state.computerId = action.payload.computerId
    },
    closeComputerDialog: (state) => {
      // Tell server the computer dialog is closed.
      const game = phaserGame.scene.keys.game as Game
      game.enableKeys()
      game.network.disconnectFromComputer(state.computerId!)
      state.computerDialogOpen = false
      state.computerId = null
    },
  },
})

export const { closeComputerDialog, openComputerDialog } = computerSlice.actions

export default computerSlice.reducer
