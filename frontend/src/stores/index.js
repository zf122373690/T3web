// FIX(P2#5): single barrel for the Pinia stores so App.vue and the
// child components can do a single import line.
export { useAuthStore } from './auth'
export { useDevicesStore } from './devices'
export { useDialogStore } from './dialog'
export { useNoticeStore } from './notice'
export { useScanStore } from './scan'
