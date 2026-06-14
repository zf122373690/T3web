"""速率限制模块.

Windows/Linux兼容: 基于SQLite的限流.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from backend.database import rate_count as _rate_count, rate_add as _rate_add, rate_reset as _rate_reset
from backend.database import nowts

logger = logging.getLogger("sms-forwarder")


class RateLimiter:
    """基于滑动窗口的速率限制器 (SQLite后端)"""
    
    def __init__(self, scope: str, max_requests: int, period: float):
        self.scope = scope
        self.max_requests = max_requests
        self.period = period
    
    def is_allowed(self, key: str) -> bool:
        """检查请求是否允许"""
        count = _rate_count(self.scope, key, self.period)
        if count >= self.max_requests:
            return False
        _rate_add(self.scope, key)
        return True
    
    def reset(self, key: str) -> None:
        """重置限制"""
        _rate_reset(self.scope, key)
    
    def get_remaining(self, key: str) -> int:
        """获取剩余请求数"""
        count = _rate_count(self.scope, key, self.period)
        return max(0, self.max_requests - count)


# 全局最大周期记录
_max_period_seen: float = 60.0


def max_period_seen() -> float:
    """获取配置的最大周期"""
    return _max_period_seen


def set_max_period(period: float) -> None:
    """设置最大周期"""
    global _max_period_seen
    _max_period_seen = max(_max_period_seen, period)