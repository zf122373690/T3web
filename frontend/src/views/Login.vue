<template>
  <div class="login-page">
    <div class="login-card">
      <h1>短信转发器</h1>
      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <input v-model="username" placeholder="用户名" class="input" required />
        </div>
        <div class="form-group">
          <input v-model="password" type="password" placeholder="密码" class="input" required />
        </div>
        <button type="submit" class="btn btn-primary" :disabled="loading">
          {{ loading ? '登录中...' : '登录' }}
        </button>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'

const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  loading.value = true
  error.value = ''
  try {
    await axios.post('/api/login', { username: username.value, password: password.value })
    router.push('/')
  } catch (e) {
    error.value = e.response?.data?.detail || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page { display: flex; justify-content: center; align-items: center; height: 100vh; background: #1a1a2e; }
.login-card { background: #fff; padding: 40px; border-radius: 12px; width: 360px; }
.login-card h1 { text-align: center; margin-bottom: 30px; color: #1a1a2e; }
.form-group { margin-bottom: 20px; }
.btn { width: 100%; margin-top: 10px; }
.error { color: #ef4444; margin-top: 10px; text-align: center; }
</style>