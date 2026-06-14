// FIX(P2#6): app-wide dialog store. Replaces window.prompt() and
// window.confirm() (which the operations team flagged as ugly inside
// the embedded iframe and unable to be styled / i18n'd) with promise-
// returning helpers backed by ConfirmModal/PromptModal components
// mounted once at the App.vue root.
//
// Usage from any store/component:
//   const dialog = useDialogStore()
//   if (!await dialog.confirm({ title: '确认删除？', danger: true })) return
//   const name = await dialog.prompt({ title: '请输入别名', defaultValue: '' })
//   if (name === null) return  // user cancelled
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useDialogStore = defineStore('dialog', () => {
  const confirmState = ref(null) // { title, message, confirmText, cancelText, danger, _resolve }
  const promptState = ref(null)  // { title, label, defaultValue, confirmText, cancelText, _resolve, value }

  function confirm({
    title = '确认',
    message = '',
    confirmText = '确定',
    cancelText = '取消',
    danger = false
  } = {}) {
    // FIX(Devin Review #7): if a previous confirm dialog is still pending,
    // resolve it as cancelled before opening a new one. Otherwise the
    // first caller's `await` would hang forever (orphaned promise) when a
    // user double-clicks two destructive buttons before the first modal
    // renders.
    if (confirmState.value && confirmState.value._resolve) {
      confirmState.value._resolve(false)
    }
    return new Promise(resolve => {
      confirmState.value = {
        title, message, confirmText, cancelText, danger,
        _resolve: resolve
      }
    })
  }

  function _resolveConfirm(answer) {
    const state = confirmState.value
    confirmState.value = null
    if (state) state._resolve(answer)
  }

  function prompt({
    title = '请输入',
    label = '',
    defaultValue = '',
    placeholder = '',
    confirmText = '确定',
    cancelText = '取消'
  } = {}) {
    // FIX(Devin Review #7): same orphan-promise guard as confirm().
    if (promptState.value && promptState.value._resolve) {
      promptState.value._resolve(null)
    }
    return new Promise(resolve => {
      promptState.value = {
        title, label, defaultValue, placeholder,
        confirmText, cancelText,
        value: defaultValue,
        _resolve: resolve
      }
    })
  }

  function _resolvePrompt(value) {
    const state = promptState.value
    promptState.value = null
    if (state) state._resolve(value)
  }

  return {
    confirmState,
    promptState,
    confirm,
    prompt,
    _resolveConfirm,
    _resolvePrompt
  }
})
