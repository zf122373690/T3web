// FIX(P2#5): auth state (logged-in flag, login/logout actions) extracted
// from App.vue. The store still delegates persistence to api/auth.js
// (sessionStorage + token migration), so the only code path moved here
// is the orchestration and notice wiring.
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { api } from '../api/client'
import { clearStoredAuth, restoreAuth as restoreStoredAuth, saveAuth } from '../api/auth'
import { healthApi, loginApi, logoutApi } from '../api/endpoints'
import { useDevicesStore } from './devices'
import { useNoticeStore } from './notice'

export const useAuthStore = defineStore('auth', () => {
  const authed = ref(false)
  const loading = ref(false)
  const uiPass = ref('')

  let interceptorInstalled = false

  function _installInterceptor() {
    if (interceptorInstalled) return
    interceptorInstalled = true
    api.interceptors.response.use(
      response => response,
      async error => {
        if (error && error.response && error.response.status === 401 && authed.value) {
          await logout()
          useNoticeStore().set('登录已失效，请重新输入密码', 'err')
        }
        return Promise.reject(error)
      }
    )
  }

  async function login() {
    const notice = useNoticeStore()
    const password = uiPass.value.trim()
    if (!password) {
      notice.set('请输入密码', 'err')
      return false
    }
    loading.value = true
    notice.clear()
    try {
      const data = await loginApi(password)
      // FIX: cookie is set by server, no need to save token locally
      authed.value = true
      uiPass.value = ''
      notice.set('登录成功', 'ok')
      return true
    } catch (e) {
      authed.value = false
      clearStoredAuth()
      const status = e && e.response && e.response.status
      const detail = e && e.response && e.response.data && e.response.data.detail
      if (status === 429) {
        notice.set(detail || '登录尝试过于频繁，请稍后再试', 'err')
      } else if (status === 401) {
        notice.set('密码错误，请重试', 'err')
      } else {
        notice.set(detail || '连接失败，请检查服务是否运行', 'err')
      }
      return false
    } finally {
      loading.value = false
    }
  }

  async function logout(showMsg = false) {
    const notice = useNoticeStore()
    try {
      await logoutApi()
    } catch {
      // ignore
    }
    authed.value = false
    uiPass.value = ''
    clearStoredAuth()
    // FIX(Devin Review #6): Clearing device selection here mirrors the
    // pre-Pinia App.vue logout flow. Without this, a 401 auto-logout
    // (triggered by the response interceptor below) would leave
    // selectedIds populated, so when the user logs back in
    // selectedCount would show a phantom count and a batch action
    // could send stale device IDs to the server.
    useDevicesStore().clearSelection()
    if (showMsg) {
      notice.set('已退出登录', 'info')
    } else {
      notice.clear()
    }
  }

  async function restore() {
    _installInterceptor()
    if (!(await restoreStoredAuth())) return false
    loading.value = true
    try {
      await healthApi()
      authed.value = true
      return true
    } catch {
      await logout()
      useNoticeStore().set('登录已过期，请重新登录', 'err')
      return false
    } finally {
      loading.value = false
    }
  }

  // Install the 401 interceptor as soon as the store is constructed so
  // that any request made before restore() (e.g. dashboard refresh after
  // a stale token) still triggers the auto-logout flow.
  _installInterceptor()

  return { authed, loading, uiPass, login, logout, restore }
})
