#!/bin/bash
# Protection RAM contre OOM — à lancer avec sudo une seule fois (ou au démarrage)
# Mode 1 : overcommit autorisé mais OOM killer actif et ciblé (pip/gcc compatibles)

set -e

cat > /etc/sysctl.d/99-memory-protection.conf << 'EOF'
# Autorise l'overcommit mais laisse l'OOM killer agir proprement
vm.overcommit_memory = 1

# Réduire l'usage agressif du swap
vm.swappiness = 10

# Tue le processus fautif, pas un process aléatoire ; pas de panic kernel
vm.panic_on_oom = 0
vm.oom_kill_allocating_task = 1
EOF

sysctl -p /etc/sysctl.d/99-memory-protection.conf

echo "Protection mémoire appliquée :"
echo "  overcommit_memory      = $(cat /proc/sys/vm/overcommit_memory)"
echo "  swappiness             = $(cat /proc/sys/vm/swappiness)"
echo "  panic_on_oom           = $(cat /proc/sys/vm/panic_on_oom)"
echo "  oom_kill_allocating_task = $(cat /proc/sys/vm/oom_kill_allocating_task)"
echo ""
echo "Tip : avant une install lourde (pip torch, ollama pull...) :"
echo "  systemd-run --scope -p MemoryMax=12G -p MemorySwapMax=2G <commande>"
