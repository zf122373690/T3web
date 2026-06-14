<template>
  <div class="sms-section">
    <div class="section-header">
      <h2>消息发送</h2>
      <div class="mode-tabs">
        <button :class="['mode-tab', { active: mode === 'sms' }]" @click="emit('update:mode', 'sms')">短信</button>
        <button :class="['mode-tab', { active: mode === 'dial' }]" @click="emit('update:mode', 'dial')">拨号</button>
      </div>
    </div>

    <div v-show="mode === 'sms'" class="form-grid">
      <SenderSelect :numbers="numbers" :value="sender" @update:value="emit('update:sender', $event)" />
      <input :value="toPhone" class="form-input" placeholder="收件人号码" @input="emit('update:toPhone', $event.target.value)" />
      <textarea :value="content" class="form-textarea" placeholder="短信内容..." rows="2" @input="emit('update:content', $event.target.value)"></textarea>
      <button class="btn-send" :disabled="loading || !sender || !toPhone || !content" @click="emit('send')">发送</button>
    </div>

    <div v-show="mode === 'dial'" class="form-grid">
      <SenderSelect :numbers="numbers" :value="sender" @update:value="emit('update:sender', $event)" />
      <input :value="dialPhone" class="form-input" placeholder="拨打的号码" @input="emit('update:dialPhone', $event.target.value)" />
      <textarea :value="ttsText" class="form-textarea" placeholder="TTS内容（可选）..." rows="2" @input="emit('update:ttsText', $event.target.value)"></textarea>
      <button class="btn-send" :disabled="loading || !sender || !dialPhone" @click="emit('dial')">拨号</button>
    </div>
  </div>
</template>

<script setup>
import SenderSelect from './SenderSelect.vue'

defineProps({
  mode: { type: String, default: 'sms' },
  numbers: { type: Array, default: () => [] },
  sender: { type: String, default: '' },
  toPhone: { type: String, default: '' },
  content: { type: String, default: '' },
  dialPhone: { type: String, default: '' },
  ttsText: { type: String, default: '' },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits([
  'update:mode',
  'update:sender',
  'update:toPhone',
  'update:content',
  'update:dialPhone',
  'update:ttsText',
  'send',
  'dial'
])
</script>
