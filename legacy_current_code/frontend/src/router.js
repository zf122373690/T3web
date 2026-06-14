import { createRouter, createWebHistory } from 'vue-router'
import Login from './views/Login.vue'
import Dashboard from './views/Dashboard.vue'
import Messages from './views/Messages.vue'
import Devices from './views/Devices.vue'
import SerialControl from './views/SerialControl.vue'
import NotificationChannels from './views/NotificationChannels.vue'
import ScheduledTasks from './views/ScheduledTasks.vue'
import LanDevices from './views/LanDevices.vue'

const routes = [
  { path: '/login', name: 'Login', component: Login },
  { path: '/', name: 'Dashboard', component: Dashboard },
  { path: '/messages', name: 'Messages', component: Messages },
  { path: '/devices', name: 'Devices', component: Devices },
  { path: '/serial', name: 'SerialControl', component: SerialControl },
  { path: '/notifications', name: 'NotificationChannels', component: NotificationChannels },
  { path: '/tasks', name: 'ScheduledTasks', component: ScheduledTasks },
  { path: '/lan-devices', name: 'LanDevices', component: LanDevices },
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router