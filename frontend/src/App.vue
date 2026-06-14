<template>
  <div class="app-container">
    <aside class="sidebar" v-if="isLoggedIn">
      <div class="logo">短信转发器</div>
      <nav>
        <router-link to="/">仪表盘</router-link>
        <router-link to="/messages">消息</router-link>
        <router-link to="/devices">设备</router-link>
        <router-link to="/serial">串口控制</router-link>
        <router-link to="/notifications">通知渠道</router-link>
        <router-link to="/tasks">定时任务</router-link>
        <router-link to="/lan-devices">局域网设备</router-link>
      </nav>
      <div class="logout" @click="logout">退出登录</div>
    </aside>
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'

const router = useRouter()
const isLoggedIn = ref(false)

onMounted(async () => {
  try {
    const res = await axios.get('/api/me')
    isLoggedIn.value = res.data?.username ? true : false
  } catch {
    isLoggedIn.value = false
  }
})

const logout = async () => {
  await axios.post('/api/auth/logout')
  isLoggedIn.value = false
  router.push('/login')
}
</script>

<style scoped>
.app-container { display: flex; height: 100vh; }
.sidebar { width: 200px; background: #1a1a2e; color: #fff; padding: 20px; display: flex; flex-direction: column; }
.logo { font-size: 18px; font-weight: bold; margin-bottom: 30px; text-align: center; }
nav { flex: 1; }
nav a { display: block; color: #ccc; padding: 12px 15px; text-decoration: none; margin-bottom: 5px; border-radius: 6px; }
nav a:hover, nav a.router-link-active { background: #16213e; color: #fff; }
.logout { padding: 12px; text-align: center; cursor: pointer; color: #ff6b6b; border-top: 1px solid #333; }
.main-content { flex: 1; background: #f5f7fa; overflow-y: auto; padding: 20px; }
</style>