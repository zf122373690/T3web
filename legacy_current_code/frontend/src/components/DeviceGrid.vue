<script setup>
import { storeToRefs } from 'pinia'

import { useDevicesStore, useScanStore } from '../stores'
import { useDeviceActions } from '../composables/useDeviceActions'
import { useDetail } from '../composables/useDetail'
import { displayName, prettyTime } from '../utils/format'

const { filteredDevices } = storeToRefs(useDevicesStore())
const { scanning } = storeToRefs(useScanStore())
const {
  startScanAdd,
  toggleSelect,
  isSelected,
  renameDevice,
  setGroup,
  deleteDevice
} = useDeviceActions()
const { showDetail } = useDetail()
</script>

<template>
  <div class="cards-grid">
    <div v-if="filteredDevices.length === 0" class="empty-state">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6z"/></svg>
      </div>
      <p>暂无设备，请先扫描</p>
      <button class="empty-btn" @click="startScanAdd" :disabled="scanning">
        {{ scanning ? '扫描中...' : '开始扫描' }}
      </button>
    </div>

    <div
      v-for="d in filteredDevices"
      :key="d.id"
      class="device-card"
      :class="{ selected: isSelected(d.id), offline: d.status !== 'online' }"
    >
      <div class="card-header">
        <div class="card-checkbox" @click="toggleSelect(d.id)">
          <span :class="['checkbox', { checked: isSelected(d.id) }]">✓</span>
        </div>
        <div class="card-status" :class="d.status">
          {{ d.status === 'online' ? '在线' : '离线' }}
        </div>
      </div>

      <div class="card-body">
        <div class="device-name">{{ displayName(d) }}</div>
        <div class="device-ip">{{ d.ip }}</div>
        <div class="device-mac">{{ d.mac || '-' }}</div>

        <div
          v-if="(d.sims && d.sims.sim1 && (d.sims.sim1.number || d.sims.sim1.operator)) || (d.sims && d.sims.sim2 && (d.sims.sim2.number || d.sims.sim2.operator))"
          class="sims-info"
        >
          <div v-if="d.sims && d.sims.sim1 && (d.sims.sim1.number || d.sims.sim1.operator)" class="sim-item">
            <span class="sim-label">SIM1</span>
            <span class="sim-op">{{ d.sims.sim1.operator || '-' }}</span>
            <span class="sim-signal" v-if="d.sims.sim1.signal > 0">{{ d.sims.sim1.signal }}%</span>
            <span class="sim-num">{{ d.sims.sim1.number || '-' }}</span>
          </div>
          <div v-if="d.sims && d.sims.sim2 && (d.sims.sim2.number || d.sims.sim2.operator)" class="sim-item">
            <span class="sim-label">SIM2</span>
            <span class="sim-op">{{ d.sims.sim2.operator || '-' }}</span>
            <span class="sim-signal" v-if="d.sims.sim2.signal > 0">{{ d.sims.sim2.signal }}%</span>
            <span class="sim-num">{{ d.sims.sim2.number || '-' }}</span>
          </div>
        </div>

        <div class="device-meta">
          <span class="device-group">{{ d.grp || 'auto' }}</span>
          <span class="device-time">{{ prettyTime(d.lastSeen) }}</span>
        </div>
      </div>

      <div class="card-actions">
        <button class="card-btn" @click="showDetail(d)" title="详情" aria-label="详情">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
        </button>
        <button class="card-btn" @click="renameDevice(d)" title="改名" aria-label="改名">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
        </button>
        <button class="card-btn" @click="setGroup(d)" title="分组" aria-label="分组">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>
        </button>
        <button class="card-btn danger" @click="deleteDevice(d)" title="删除" aria-label="删除">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>
