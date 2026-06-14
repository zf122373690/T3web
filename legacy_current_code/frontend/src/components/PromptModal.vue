<template>
  <div v-if="promptState" class="modal-overlay" @click.self="cancel">
    <div class="modal modal-sm">
      <div class="modal-header">
        <h3>{{ promptState.title }}</h3>
        <button class="modal-close" @click="cancel">×</button>
      </div>
      <div class="modal-body">
        <label v-if="promptState.label" class="prompt-label">{{ promptState.label }}</label>
        <input
          ref="inputRef"
          v-model="inputValue"
          class="form-input"
          :placeholder="promptState.placeholder"
          @keyup.enter="confirm"
        />
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" @click="cancel">{{ promptState.cancelText }}</button>
        <button class="btn-confirm" @click="confirm">{{ promptState.confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useDialogStore } from '../stores/dialog'

const dialogStore = useDialogStore()
const { promptState } = storeToRefs(dialogStore)
const inputRef = ref(null)
const inputValue = ref('')

watch(promptState, next => {
  if (next) {
    inputValue.value = next.defaultValue || ''
    nextTick(() => {
      if (inputRef.value) {
        inputRef.value.focus()
        inputRef.value.select()
      }
    })
  }
})

function confirm() {
  // FIX(P2#6): match window.prompt() semantics -- Enter / Confirm
  // resolves with the typed string (possibly empty), cancel resolves
  // with null so callers can distinguish "" from "user dismissed".
  dialogStore._resolvePrompt(inputValue.value)
}

function cancel() {
  dialogStore._resolvePrompt(null)
}

function onKeydown(e) {
  if (!promptState.value) return
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
.prompt-label { display: block; margin-bottom: 8px; font-weight: 500; }
</style>
