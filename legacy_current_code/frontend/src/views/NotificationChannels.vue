<template>
  <div class="page">
    <h1 class="page-title">通知渠道</h1>
    <div class="card">
      <button class="btn btn-primary" @click="showAdd = true" style="margin-bottom: 15px;">添加渠道</button>
      <table class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>地址</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in channels" :key="c.id">
            <td>{{ c.name }}</td>
            <td>{{ c.type }}</td>
            <td>{{ c.url }}</td>
            <td :class="c.enabled ? 'online' : 'offline'">{{ c.enabled ? '启用' : '禁用' }}</td>
            <td>
              <button class="btn btn-primary" @click="toggleChannel(c)">{{ c.enabled ? '禁用' : '启用' }}</button>
              <button class="btn btn-danger" @click="deleteChannel(c)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!channels.length" class="empty">暂无通知渠道</p>
    </div>

    <div v-if="showAdd" class="modal">
      <div class="modal-content">
        <h3>添加通知渠道</h3>
        <div class="form-group">
          <input v-model="newChannel.name" placeholder="名称" class="input" />
        </div>
        <div class="form-group">
          <select v-model="newChannel.type" class="input">
            <option value="webhook">Webhook</option>
            <option value="email">Email</option>
            <option value="telegram">Telegram</option>
          </select>
        </div>
        <div class="form-group">
          <input v-model="newChannel.url" placeholder="地址" class="input" />
        </div>
        <button class="btn btn-primary" @click="addChannel">保存</button>
        <button class="btn" @click="showAdd = false">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const channels = ref([])
const showAdd = ref(false)
const newChannel = ref({ name: '', type: 'webhook', url: '' })

const loadChannels = async () => {
  try {
    const res = await axios.get('/api/channels')
    channels.value = res.data || []
  } catch (e) {
    console.error(e)
  }
}

const addChannel = async () => {
  try {
    await axios.post('/api/channels', newChannel.value)
    showAdd.value = false
    newChannel.value = { name: '', type: 'webhook', url: '' }
    await loadChannels()
  } catch (e) {
    alert('添加失败')
  }
}

const toggleChannel = async (c) => {
  try {
    await axios.put(`/api/channels/${c.id}`, { enabled: !c.enabled })
    await loadChannels()
  } catch (e) {
    alert('操作失败')
  }
}

const deleteChannel = async (c) => {
  if (confirm(`确定要删除渠道 ${c.name} 吗?`)) {
    try {
      await axios.delete(`/api/channels/${c.id}`)
      await loadChannels()
    } catch (e) {
      alert('删除失败')
    }
  }
}

onMounted(loadChannels)
</script>

<style scoped>
.online { color: #22c55e; }
.offline { color: #ef4444; }
.modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.modal-content { background: #fff; padding: 30px; border-radius: 8px; width: 400px; }
.modal-content h3 { margin-bottom: 20px; }
.form-group { margin-bottom: 15px; }
</style>