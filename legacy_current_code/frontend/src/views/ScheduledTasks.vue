<template>
  <div class="page">
    <h1 class="page-title">定时任务</h1>
    <div class="card">
      <button class="btn btn-primary" @click="showAdd = true" style="margin-bottom: 15px;">添加任务</button>
      <table class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>时间</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tasks" :key="t.id">
            <td>{{ t.name }}</td>
            <td>{{ t.type }}</td>
            <td>{{ t.time }}</td>
            <td :class="t.enabled ? 'online' : 'offline'">{{ t.enabled ? '启用' : '禁用' }}</td>
            <td>
              <button class="btn btn-primary" @click="toggleTask(t)">{{ t.enabled ? '禁用' : '启用' }}</button>
              <button class="btn btn-danger" @click="deleteTask(t)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!tasks.length" class="empty">暂无定时任务</p>
    </div>

    <div v-if="showAdd" class="modal">
      <div class="modal-content">
        <h3>添加定时任务</h3>
        <div class="form-group">
          <input v-model="newTask.name" placeholder="名称" class="input" />
        </div>
        <div class="form-group">
          <select v-model="newTask.type" class="input">
            <option value="sms">发送短信</option>
            <option value="check">检查设备</option>
            <option value="restart">重启设备</option>
          </select>
        </div>
        <div class="form-group">
          <input v-model="newTask.time" placeholder="Cron表达式，如 0 8 * * *" class="input" />
        </div>
        <button class="btn btn-primary" @click="addTask">保存</button>
        <button class="btn" @click="showAdd = false">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const tasks = ref([])
const showAdd = ref(false)
const newTask = ref({ name: '', type: 'sms', time: '' })

const loadTasks = async () => {
  try {
    const res = await axios.get('/api/tasks')
    tasks.value = res.data || []
  } catch (e) {
    console.error(e)
  }
}

const addTask = async () => {
  try {
    await axios.post('/api/tasks', newTask.value)
    showAdd.value = false
    newTask.value = { name: '', type: 'sms', time: '' }
    await loadTasks()
  } catch (e) {
    alert('添加失败')
  }
}

const toggleTask = async (t) => {
  try {
    await axios.put(`/api/tasks/${t.id}`, { enabled: !t.enabled })
    await loadTasks()
  } catch (e) {
    alert('操作失败')
  }
}

const deleteTask = async (t) => {
  if (confirm(`确定要删除任务 ${t.name} 吗?`)) {
    try {
      await axios.delete(`/api/tasks/${t.id}`)
      await loadTasks()
    } catch (e) {
      alert('删除失败')
    }
  }
}

onMounted(loadTasks)
</script>

<style scoped>
.online { color: #22c55e; }
.offline { color: #ef4444; }
.modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.modal-content { background: #fff; padding: 30px; border-radius: 8px; width: 400px; }
.modal-content h3 { margin-bottom: 20px; }
.form-group { margin-bottom: 15px; }
</style>