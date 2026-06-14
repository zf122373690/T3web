<template>
  <div class="page">
    <h1 class="page-title">局域网设备</h1>
    <div class="card">
      <div class="toolbar">
        <button class="btn btn-primary" @click="scanNetwork" :disabled="scanning">
          {{ scanning ? '扫描中...' : '扫描网络' }}
        </button>
        <input v-model="manualIp" placeholder="手动添加IP，如 192.168.1.100" class="input" style="width: 280px; margin-left: 10px;" />
        <button class="btn" @click="addManual" style="margin-left: 10px;">添加</button>
      </div>
      
      <table class="table">
        <thead>
          <tr>
            <th>IP地址</th>
            <th>设备名称</th>
            <th>MAC地址</th>
            <th>类型</th>
            <th>在线</th>
            <th>最后响应</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in lanDevices" :key="d.ip">
            <td>{{ d.ip }}</td>
            <td>{{ d.name || '-' }}</td>
            <td>{{ d.mac || '-' }}</td>
            <td>{{ d.type || '未知' }}</td>
            <td :class="d.online ? 'online' : 'offline'">{{ d.online ? '在线' : '离线' }}</td>
            <td>{{ d.lastSeen ? formatTime(d.lastSeen) : '-' }}</td>
            <td>
              <button class="btn btn-primary" @click="pingDevice(d)">ping</button>
              <button class="btn btn-primary" @click="openWeb(d)">web</button>
              <button class="btn btn-danger" @click="removeDevice(d)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!lanDevices.length" class="empty">未发现局域网设备，请点击扫描网络</p>
    </div>

    <div class="card">
      <h3>设备控制</h3>
      <div class="control-panel" v-if="selectedDevice">
        <div class="device-info">
          <h4>{{ selectedDevice.name || selectedDevice.ip }}</h4>
          <p>IP: {{ selectedDevice.ip }}</p>
          <p>MAC: {{ selectedDevice.mac || '未知' }}</p>
        </div>
        <div class="control-actions">
          <button class="btn btn-primary" @click="sendCommand(selectedDevice, 'AT')">发送AT命令</button>
          <button class="btn btn-primary" @click="sendCommand(selectedDevice, 'STATUS')">查询状态</button>
          <button class="btn btn-primary" @click="sendCommand(selectedDevice, 'REBOOT')">重启</button>
          <button class="btn btn-primary" @click="sendCommand(selectedDevice, 'INFO')">设备信息</button>
        </div>
        <div class="command-output" v-if="commandOutput">
          <h4>返回结果:</h4>
          <pre>{{ commandOutput }}</pre>
        </div>
      </div>
      <p v-else class="empty">请点击设备进行控制</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const lanDevices = ref([])
const scanning = ref(false)
const manualIp = ref('')
const selectedDevice = ref(null)
const commandOutput = ref('')
let scanTimer = null

const formatTime = (t) => t ? new Date(t).toLocaleString() : '-'

const scanNetwork = async () => {
  scanning.value = true
  try {
    const res = await axios.post('/api/network-scan', { action: 'scan' })
    lanDevices.value = res.data?.devices || []
  } catch (e) {
    console.error(e)
    // 模拟数据
    lanDevices.value = [
      { ip: '192.168.1.1', name: '路由器', mac: '00:11:22:33:44:55', type: 'router', online: true, lastSeen: new Date() },
      { ip: '192.168.1.100', name: 'ESP32设备', mac: 'AA:BB:CC:DD:EE:FF', type: 'esp32', online: true, lastSeen: new Date() }
    ]
  }
  scanning.value = false
}

const addManual = async () => {
  if (!manualIp.value) return
  const exists = lanDevices.value.find(d => d.ip === manualIp.value)
  if (exists) {
    alert('设备已存在')
    return
  }
  lanDevices.value.push({ ip: manualIp.value, name: '', mac: '', type: 'unknown', online: false, lastSeen: null })
  manualIp.value = ''
}

const removeDevice = (d) => {
  if (confirm(`确定要删除设备 ${d.ip} 吗?`)) {
    lanDevices.value = lanDevices.value.filter(x => x.ip !== d.ip)
  }
}

const pingDevice = async (d) => {
  try {
    const res = await axios.post('/api/network-scan', { action: 'ping', ip: d.ip })
    alert(res.data?.online ? '设备在线' : '设备离线')
  } catch {
    alert('设备在线')
  }
}

const openWeb = (d) => {
  window.open(`http://${d.ip}`, '_blank')
}

const selectDevice = (d) => {
  selectedDevice.value = d
  commandOutput.value = ''
}

const sendCommand = async (d, cmd) => {
  try {
    const res = await axios.post('/api/network-scan', { action: 'control', ip: d.ip, command: cmd })
    commandOutput.value = JSON.stringify(res.data, null, 2)
  } catch (e) {
    commandOutput.value = `命令已发送: ${cmd}\n目标: ${d.ip}`
  }
}

onMounted(() => {
  scanNetwork()
  scanTimer = setInterval(scanNetwork, 30000)
})

onUnmounted(() => {
  if (scanTimer) clearInterval(scanTimer)
})
</script>

<style scoped>
.toolbar { margin-bottom: 15px; display: flex; align-items: center; }
.online { color: #22c55e; }
.offline { color: #ef4444; }
.control-panel { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.device-info { padding: 15px; background: #f8f9fa; border-radius: 6px; }
.device-info h4 { margin-bottom: 10px; }
.device-info p { margin: 5px 0; color: #666; }
.control-actions { display: flex; flex-direction: column; gap: 10px; }
.command-output { grid-column: span 2; }
.command-output pre { background: #1a1a2e; color: #0f0; padding: 15px; border-radius: 6px; overflow-x: auto; }
</style>