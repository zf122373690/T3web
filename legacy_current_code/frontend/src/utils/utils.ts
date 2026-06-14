export const formatUptime = (seconds: number | undefined | null): string => {
    if (seconds === undefined || seconds === null) return '-';
    if (seconds <= 0) return '0 秒';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];

    // 智能显示：只显示最重要的两个单位，避免文本过长
    if (days > 0) {
        parts.push(`${days} 天`);
        if (hours > 0) parts.push(`${hours} 小时`);
    } else if (hours > 0) {
        parts.push(`${hours} 小时`);
        if (minutes > 0) parts.push(`${minutes} 分钟`);
    } else if (minutes > 0) {
        parts.push(`${minutes} 分钟`);
    }

    return parts.length > 0 ? parts.join(' ') : '不到 1 分钟';
};