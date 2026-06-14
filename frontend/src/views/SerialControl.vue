<template>
  <div class="page">
    <h1 class="page-title">串口控制</h1>
    <div class="card">
      <div class="form-group">
        <label>选择设备</label>
        <select v-model="selectedDevice" class="input">
          <option value="">请选择设备</option>
          <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>
      <div class="terminal" ref="terminalRef">
        <div v-for="(line, i) in logs" :key="i" :class="line.type">{{ line.text }}</div>
      </div>
      <div class="input-area">
        <input v-model="command" placeholder="输入AT命令..." class="input" @keyup.enter="sendCommand" />
        <button class="btn btn-primary" @click="sendCommand" :disabled="!selectedDevice">发送</button>
        <button class="btn btn-danger" @click="clearLogs">清空</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import axios from 'axios'

const devices = ref([])
const selectedDevice = ref('')
const command = ref('')
const logs = ref([])
const terminalRef = ref(null)

const loadDevices = async () => {
  try {
    const res = await axios.get('/api/devices')
    devices.value = res.data || []
  } catch (e) {
    console.error(e)
  }
}

const sendCommand = async () => {
  if (!command.value || !selectedDevice.value) return
  logs.value.push({ type: 'sent', text: `> ${command.value}` })
  try {
    const res = await axios.post(`/api/devices/${selectedDevice.value}/at`, { command: command.value })
    logs.value.push({ type: 'received', text: `< ${res.data.response}` })
  } catch (e) {
    logs.value.push({ type: 'error', text: `< 错误: ${e.message}` })
  }
  command.value = ''
  await nextTick()
  if (terminalRef.value) {
    terminalRef.value.scrollTop = terminalRef.value.scrollHeight
  }
}

const clearLogs = () => {
  logs.value = []
}

onMounted(loadDevices)
</script>

<style scoped>
.form-group { margin-bottom: 15px; }
.form-group label { display: block; margin-bottom: 5px; font-weight: 600; }
.terminal { background: #1a1a2e; color: #0f0; padding: 15px; height: 300px; overflow-y: auto; font-family: monospace; border-radius: 6px; margin-bottom: 15px; }
.terminal .sent { color: #0ff; }
.terminal .received { color: #0f0; }
.terminal .error { color: #f00; }
.input-area { display: flex; gap: 10px; }
.input-area .input { flex: 1; }
</style>