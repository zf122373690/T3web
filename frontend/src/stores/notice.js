// FIX(P2#5): banner notice state extracted into a Pinia store. Other
// stores (auth, devices, scan) reach for setNotice through this module
// instead of passing a callback into the App component.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useNoticeStore = defineStore('notice', () => {
  const text = ref('')
  const type = ref('info')

  function set(nextText, nextType = 'info') {
    text.value = nextText
    type.value = nextType
  }

  function clear() {
    text.value = ''
    type.value = 'info'
  }

  return { text, type, set, clear }
})
