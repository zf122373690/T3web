import { ref } from 'vue'

import { sendSms, dialDevice } from '../api/endpoints'
import { useLoading } from './useLoading'
import { useNotice } from './useNotice'

// SMS + dial workflow (they share the sender select + parse helper).
// Module-level singleton so the MessagePanel bindings and App.vue use the
// same state.
const commMode = ref('sms')
const fromSelected = ref('')
const toPhone = ref('')
const content = ref('')
const dialPhone = ref('')
const ttsText = ref('')

function parseSenderValue() {
  const raw = String(fromSelected.value || '')
  const parts = raw.split('|')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const deviceId = Number(parts[0])
  const slot = Number(parts[1])
  if (!Number.isInteger(deviceId) || !Number.isInteger(slot)) return null
  return { deviceId, slot }
}

export function useMessaging() {
  const loading = useLoading()
  const { setNotice, errText } = useNotice()

  async function send() {
    if (!fromSelected.value || !toPhone.value || !content.value) {
      setNotice('请填写完整', 'err')
      return
    }
    const sender = parseSenderValue()
    if (!sender) {
      setNotice('请选择有效的发送卡号', 'err')
      return
    }
    loading.value = true
    try {
      await sendSms({
        deviceId: sender.deviceId,
        phone: toPhone.value,
        content: content.value,
        slot: sender.slot
      })
      setNotice('已发送', 'ok')
      toPhone.value = ''
      content.value = ''
    } catch (e) {
      setNotice(errText(e, '发送失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  async function dial() {
    if (!fromSelected.value || !dialPhone.value) {
      setNotice('请填写完整', 'err')
      return
    }
    const sender = parseSenderValue()
    if (!sender) {
      setNotice('请选择有效的拨号卡号', 'err')
      return
    }
    loading.value = true
    try {
      await dialDevice({
        deviceId: sender.deviceId,
        phone: dialPhone.value,
        slot: sender.slot,
        tts: ttsText.value
      })
      setNotice('已拨出', 'ok')
      dialPhone.value = ''
      ttsText.value = ''
    } catch (e) {
      setNotice(errText(e, '拨号失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  return { commMode, fromSelected, toPhone, content, dialPhone, ttsText, send, dial }
}
