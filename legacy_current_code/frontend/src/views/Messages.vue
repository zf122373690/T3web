<template>
  <div class="page">
    <h1 class="page-title">消息管理</h1>
    <div class="card">
      <div class="toolbar">
        <input v-model="search" placeholder="搜索内容..." class="input" style="width: 300px;" @input="loadMessages" />
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>时间</th>
            <th>设备</th>
            <th>来自</th>
            <th>内容</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in messages" :key="m.id">
            <td>{{ formatTime(m.time) }}</td>
            <td>{{ m.device }}</td>
            <td>{{ m.from }}</td>
            <td>{{ m.content }}</td>
            <td>
              <button class="btn btn-primary" @click="viewMessage(m)">查看</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!messages.length" class="empty">暂无消息</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const messages = ref([])
const search = ref('')

const formatTime = (t) => t ? new Date(t).toLocaleString() : '-'

const loadMessages = async () => {
  try {
    const res = await axios.get('/api/messages', { params: { page: 1, page_size: 100, search: search.value } })
    messages.value = res.data?.items || []
  } catch (e) {
    console.error(e)
  }
}

const viewMessage = (m) => {
  alert(`来自: ${m.from}\n时间: ${formatTime(m.time)}\n内容: ${m.content}`)
}

onMounted(loadMessages)
</script>

<style scoped>
.toolbar { margin-bottom: 15px; }
</style>