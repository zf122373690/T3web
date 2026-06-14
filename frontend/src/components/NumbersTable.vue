<script setup>
import { storeToRefs } from 'pinia'

import { useDevicesStore } from '../stores'
import Pagination from './Pagination.vue'

const devicesStore = useDevicesStore()
const { filteredNumbers } = storeToRefs(devicesStore)
</script>

<template>
  <div class="numbers-table">
    <div v-if="filteredNumbers.length === 0" class="empty-state">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>
      </div>
      <p>暂无号码数据</p>
    </div>
    <table v-else>
      <thead>
        <tr>
          <th>号码</th><th>运营商</th><th>设备</th><th>IP</th><th>槽位</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="n in filteredNumbers" :key="String(n.deviceId) + '-' + String(n.slot)">
          <td class="mono">{{ n.number }}</td>
          <td>{{ n.operator || '-' }}</td>
          <td>{{ n.deviceName }}</td>
          <td class="mono">{{ n.ip }}</td>
          <td>SIM{{ n.slot }}</td>
        </tr>
      </tbody>
    </table>
    <Pagination
      :page="devicesStore.numbersPage"
      :pages="devicesStore.numbersPages"
      :page-size="devicesStore.numbersPageSize"
      :total="devicesStore.numbersTotal"
      @change="devicesStore.setNumbersPage"
    />
  </div>
</template>
