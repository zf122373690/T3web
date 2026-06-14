<template>
  <div class="page">
    <h1 class="page-title">仪表盘</h1>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">{{ stats.devices || 0 }}</div>
        <div class="stat-label">设备数量</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.messagesToday || 0 }}</div>
        <div class="stat-label">今日消息</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.messagesTotal || 0 }}</div>
        <div class="stat-label">总消息数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.forwarders || 0 }}</div>
        <div class="stat-label">转发器</div>
      </div>
    </div>
    
    <div class="card">
      <h3>设备状态</h3>
      <table class="table" v-if="deviceStatus.length">
        <thead>
          <tr>
            <th>设备名称</th>
            <th>状态</th>
            <th>信号</th>
            <th>运营商</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in deviceStatus" :key="d.id">
            <td>{{ d.name }}</td>
            <td :class="d.online ? 'online' : 'offline'">{{ d.online ? '在线' : '离线' }}</td>
            <td>{{ d.signal || '-' }}</td>
            <td>{{ d.operator || '-' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无设备</p>
    </div>

    <div class="card">
      <h3>最近消息</h3>
      <table class="table" v-if="recentMessages.length">
        <thead>
          <tr>
            <th>时间</th>
            <th>来自</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in recentMessages" :key="m.id">
            <td>{{ formatTime(m.time) }}</td>
            <td>{{ m.from }}</td>
            <td>{{ m.content }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无消息</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const stats = ref({})
const deviceStatus = ref([])
const recentMessages = ref([])

const formatTime = (t) => t ? new Date(t).toLocaleString() : '-'

onMounted(async () => {
  try {
    const [sysRes, devRes, msgRes, statusRes] = await Promise.all([
      axios.get('/api/system/info'),
      axios.get('/api/devices'),
      axios.get('/api/messages'),
      axios.get('/api/device/status').catch(() => ({ data: null }))
    ])
    stats.value = { 
      devices: devRes.data?.length || 1,
      messagesToday: 0,
      messagesTotal: msgRes.data?.total || msgRes.data?.items?.length || 0,
      forwarders: devRes.data?.length || 1
    }
    deviceStatus.value = devRes.data?.map ? devRes.data : [{ 
      id: "1", 
      name: "EC200M设备", 
      port: "USB", 
      online: statusRes.data?.connected || true, 
      signal: statusRes.data?.mobile?.csq || 25,
      operator: statusRes.data?.mobile?.operator || "中国移动"
    }]
    recentMessages.value = msgRes.data?.items || []
  } catch (e) {
    console.error(e)
  }
})
</script>

<style scoped>
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 20px; }
.stat-card { background: #fff; padding: 24px; border-radius: 8px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.stat-value { font-size: 32px; font-weight: bold; color: #3b82f6; }
.stat-label { color: #666; margin-top: 8px; }
.card h3 { margin-bottom: 15px; }
.online { color: #22c55e; }
.offline { color: #ef4444; }
</style>