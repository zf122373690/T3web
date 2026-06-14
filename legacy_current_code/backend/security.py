"""安全模块 - IP白名单、SSRF防护.

Windows/Linux兼容: 内网安全检查.
"""

from __future__ import annotations

import logging
import ipaddress
import os
import re
import socket
from typing import List, Optional, Set, Tuple

from backend.config import (
    CIDRFALLBACKLIMIT,
    LOCAL_NETS_CACHE_TTL,
    TRUSTED_PROXY_HOPS,
)

logger = logging.getLogger("sms-forwarder")

# 缓存
_local_nets: Optional[Set[ipaddress.IPv4Network]] = None
_local_nets_cache_time: float = 0


def _is_private_ip(ip: str) -> bool:
    """检查是否为私有IP地址"""
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback
    except ValueError:
        return False


def _parse_ipv4_cidr(cidr: str) -> Optional[ipaddress.IPv4Network]:
    """解析IPv4 CIDR"""
    try:
        return ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        return None


def _guess_local_nets() -> Set[ipaddress.IPv4Network]:
    """猜测本机所在的内网网段"""
    global _local_nets, _local_nets_cache_time
    
    import time
    now = time.time()
    
    # 使用缓存
    if _local_nets is not None and (now - _local_nets_cache_time) < LOCAL_NETS_CACHE_TTL:
        return _local_nets
    
    nets: Set[ipaddress.IPv4Network] = set()
    
    try:
        # 获取本机主机名
        hostname = socket.gethostname()
        # 获取本机IP地址
        local_ip = socket.gethostbyname(hostname)
        
        # 根据本机IP推断内网网段
        if local_ip:
            parts = local_ip.split('.')
            if len(parts) == 4:
                # 常见内网段
                for prefix in ['192.168', '10.', '172.16', '172.17', '172.18', 
                              '172.19', '172.20', '172.21', '172.22', '172.23',
                              '172.24', '172.25', '172.26', '172.27', '172.28',
                              '172.29', '172.30', '172.31']:
                    if local_ip.startswith(prefix):
                        if prefix == '192.168':
                            nets.add(ipaddress.IPv4Network('192.168.0.0/16', strict=False))
                        elif prefix == '10.':
                            nets.add(ipaddress.IPv4Network('10.0.0.0/8', strict=False))
                        elif prefix.startswith('172.'):
                            nets.add(ipaddress.IPv4Network('172.16.0.0/12', strict=False))
                        break
                else:
                    # 未匹配到常见内网段，尝试添加/24子网
                    nets.add(ipaddress.IPv4Network(f"{parts[0]}.{parts[1]}.{parts[2]}.0/24", strict=False))
    except Exception as e:
        logger.debug("guess local nets failed: %s", e)
    
    # 添加默认内网段
    if not nets:
        nets.add(ipaddress.IPv4Network('192.168.0.0/16', strict=False))
        nets.add(ipaddress.IPv4Network('10.0.0.0/8', strict=False))
        nets.add(ipaddress.IPv4Network('172.16.0.0/12', strict=False))
    
    _local_nets = nets
    _local_nets_cache_time = now
    logger.info("local nets: %s", [str(n) for n in nets])
    return nets


def guess_ipv4_cidr() -> str:
    """获取猜测的内网CIDR"""
    nets = _guess_local_nets()
    if nets:
        # 返回最小的网段
        smallest = min(nets, key=lambda n: n.num_addresses)
        return str(smallest)
    return "192.168.0.0/16"


def is_device_ip_allowed(ip: str) -> bool:
    """检查设备IP是否在允许的内网范围内"""
    # 始终允许私有IP
    if _is_private_ip(ip):
        return True
    
    # 检查是否在内网网段内
    try:
        addr = ipaddress.ip_address(ip)
        for net in _guess_local_nets():
            if addr in net:
                return True
    except ValueError:
        pass
    
    return False


def client_ip_from_request(request) -> str:
    """从请求中获取客户端真实IP"""
    # 检查X-Forwarded-For头
    forwarded = request.headers.get("X-Forwarded-For", "").strip()
    if forwarded:
        # 取第一个IP（原始客户端）
        first_ip = forwarded.split(",")[0].strip()
        if first_ip:
            return first_ip
    
    # 检查X-Real-IP头
    real_ip = request.headers.get("X-Real-IP", "").strip()
    if real_ip:
        return real_ip
    
    # 使用直接连接的客户端IP
    return request.client.host if request.client else ""


def tcp_port_open(ip: str, port: int, timeout: float = 0.3) -> bool:
    """检查TCP端口是否开放"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((ip, port))
        sock.close()
        return result == 0
    except Exception:
        return False


def get_arp_table() -> List[Tuple[str, str]]:
    """获取ARP表 (Windows/Linux兼容)"""
    import subprocess
    result = []
    
    try:
        # Windows: arp -a
        if os.name == 'nt':
            output = subprocess.check_output(['arp', '-a'], text=True, timeout=5)
            # 解析ARP表
            for line in output.splitlines():
                match = re.match(r'(\d+\.\d+\.\d+\d+)\s+([0-9a-f-]{17})', line, re.IGNORECASE)
                if match:
                    result.append((match.group(1), match.group(2)))
        else:
            # Linux: ip neigh show
            output = subprocess.check_output(['ip', 'neigh', 'show'], text=True, timeout=5)
            for line in output.splitlines():
                parts = line.split()
                if len(parts) >= 4 and parts[2] == 'lladdr':
                    result.append((parts[0], parts[3]))
    except Exception as e:
        logger.debug("get arp table failed: %s", e)
    
    return result


def prewarm_neighbors(cidr: str) -> None:
    """预热邻居缓存 (发送ARP请求)"""
    import subprocess
    
    try:
        net = ipaddress.ip_network(cidr, strict=False)
        # 限制扫描数量
        if net.num_addresses > CIDRFALLBACKLIMIT:
            logger.warning("cidr %s too large, skipping prewarm", cidr)
            return
        
        # Windows用ping, Linux用arping或ping
        if os.name == 'nt':
            # Windows: 并行ping /24子网
            subprocess.Popen(['ping', '-n', '1', '-w', '200', f'{net.network_address}'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            # Linux
            subprocess.Popen(['ping', '-c', '1', '-W', '1', f'{net.network_address}'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        logger.debug("prewarm neighbors failed: %s", e)


def validate_startup_security() -> None:
    """启动时安全检查"""
    from backend.config import UIPASS
    
    # 检查默认密码
    if UIPASS == "admin":
        logger.warning("using default password - this is insecure for production!")