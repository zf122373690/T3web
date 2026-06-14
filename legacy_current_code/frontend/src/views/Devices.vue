<template>
  <div class="page">
    <h1 class="page-title">设备管理</h1>
    <div class="card">
      <button class="btn btn-primary" @click="refreshDevices" style="margin-bottom: 15px;">刷新设备</button>
      <table class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>端口</th>
            <th>状态</th>
            <th>信号</th>
            <th>运营商</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in devices" :key="d.id">
            <td>{{ d.name }}</td>
            <td>{{ d.port }}</td>
            <td :class="d.online ? 'online' : 'offline'">{{ d.online ? '在线' : '离线' }}</td>
            <td>{{ d.signal || '-' }}</td>
            <td>{{ d.operator || '-' }}</td>
            <td>
              <button class="btn btn-primary" @click="restartDevice(d)">重启</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!devices.length" class="empty">未发现设备</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const devices = ref([])

const loadDevices = async () => {
  try {
    const res = await axios.get('/api/devices')
    devices.value = res.data || []
  } catch (e) {
    console.error(e)
  }
}

const refreshDevices = async () => {
  await loadDevices()
}

const restartDevice = async (d) => {
  if (confirm(`确定要重启设备 ${d.name} 吗?`)) {
    try {
      await axios.post(`/api/devices/${d.id}/restart`)
      alert('重启指令已发送')
    } catch (e) {
      alert('重启失败')
    }
  }
}

onMounted(loadDevices)
</script>

<style scoped>
.online { color: #22c55e; }
.offline { color: #ef4444; }
</style>