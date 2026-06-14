<template>
  <div v-if="confirmState" class="modal-overlay" @click.self="cancel">
    <div class="modal modal-sm">
      <div class="modal-header">
        <h3>{{ confirmState.title }}</h3>
        <button class="modal-close" @click="cancel">×</button>
      </div>
      <div v-if="confirmState.message" class="modal-body">
        <p class="confirm-message">{{ confirmState.message }}</p>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" @click="cancel">{{ confirmState.cancelText }}</button>
        <button
          ref="confirmBtnRef"
          :class="confirmState.danger ? 'btn-confirm danger-btn' : 'btn-confirm'"
          @click="confirm"
        >{{ confirmState.confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useDialogStore } from '../stores/dialog'

const dialogStore = useDialogStore()
const { confirmState } = storeToRefs(dialogStore)
const confirmBtnRef = ref(null)

watch(confirmState, next => {
  if (next) {
    // FIX(P2#6): focus the primary button when the dialog opens so
    // Enter accepts and Esc / overlay click cancels -- closest we can
    // get to native confirm() ergonomics without a focus trap library.
    nextTick(() => confirmBtnRef.value && confirmBtnRef.value.focus())
  }
})

function confirm() {
  dialogStore._resolveConfirm(true)
}

function cancel() {
  dialogStore._resolveConfirm(false)
}

// FIX(P2#6, Devin Review #7): Esc is intercepted globally because it
// unambiguously means "cancel". Enter is intentionally NOT handled here:
// the confirm button is auto-focused on open, and the browser's native
// Enter-on-focused-button behaviour means Enter still confirms for the
// happy path. If the user Tabs to Cancel and presses Enter, the native
// button activation correctly cancels instead -- a global Enter handler
// would have stolen that and confirmed the destructive action.
function onKeydown(e) {
  if (!confirmState.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    cancel()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.modal-sm { max-width: 420px; }
.confirm-message { white-space: pre-line; line-height: 1.5; margin: 0; }
</style>
