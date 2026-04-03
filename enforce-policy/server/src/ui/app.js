function app() {
  return {
    activeTab: 'dashboard',
    connected: false,
    health: { uptime: '-' },
    stats: { allowed: 0, denied: 0, blocked: 0, warned: 0, policies: 0 },
    violations: [],
    policies: [],
    auditEntries: [],
    auditTotal: 0,
    auditOffset: 0,
    auditFilters: { decision: '', tool: '', session: '', from: '', to: '' },
    eventSource: null,

    async init() {
      await Promise.all([
        this.fetchHealth(),
        this.fetchStats(),
        this.fetchPolicies(),
        this.fetchAudit(),
        this.fetchViolations(),
      ]);
      this.connectSSE();

      // Refresh stats every 30 seconds
      setInterval(() => this.fetchStats(), 30000);
    },

    async fetchHealth() {
      try {
        const res = await fetch('/api/health');
        this.health = await res.json();
        this.connected = true;
      } catch {
        this.connected = false;
      }
    },

    async fetchStats() {
      try {
        const res = await fetch('/api/audit/stats');
        this.stats = await res.json();
      } catch { /* ignore */ }
    },

    async fetchPolicies() {
      try {
        const res = await fetch('/api/policies');
        const data = await res.json();
        this.policies = data.policies.map(p => ({ ...p, _expanded: false }));
      } catch { /* ignore */ }
    },

    async fetchAudit() {
      try {
        const params = new URLSearchParams();
        params.set('limit', '50');
        params.set('offset', String(this.auditOffset));
        for (const [k, v] of Object.entries(this.auditFilters)) {
          if (v) params.set(k, v);
        }
        const res = await fetch('/api/audit?' + params.toString());
        const data = await res.json();
        this.auditEntries = data.entries.map(e => ({ ...e, _expanded: false }));
        this.auditTotal = data.total;
      } catch { /* ignore */ }
    },

    async fetchViolations() {
      try {
        const res = await fetch('/api/audit?limit=20&decision=deny');
        const denyData = await res.json();
        const res2 = await fetch('/api/audit?limit=20&decision=block');
        const blockData = await res2.json();
        const res3 = await fetch('/api/audit?limit=20&decision=warn');
        const warnData = await res3.json();

        this.violations = [...denyData.entries, ...blockData.entries, ...warnData.entries]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 20);
      } catch { /* ignore */ }
    },

    async togglePolicy(name) {
      try {
        const res = await fetch(`/api/policies/${encodeURIComponent(name)}/toggle`, { method: 'PATCH' });
        const data = await res.json();
        const policy = this.policies.find(p => p.name === name);
        if (policy) policy.enabled = data.enabled;
        await this.fetchStats();
      } catch { /* ignore */ }
    },

    async reloadPolicies() {
      try {
        await fetch('/api/policies/reload', { method: 'POST' });
        await this.fetchPolicies();
        await this.fetchStats();
      } catch { /* ignore */ }
    },

    exportAudit() {
      const blob = new Blob([JSON.stringify(this.auditEntries, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    connectSSE() {
      this.eventSource = new EventSource('/api/audit/stream');
      this.eventSource.onmessage = (event) => {
        try {
          const entry = JSON.parse(event.data);
          if (entry.type === 'connected') return;

          // Update violations if it's a violation
          if (entry.decision !== 'allow') {
            this.violations.unshift(entry);
            if (this.violations.length > 20) this.violations.pop();
          }

          // Refresh stats
          this.fetchStats();

          // Update audit tab if visible
          if (this.activeTab === 'audit') {
            this.fetchAudit();
          }
        } catch { /* ignore */ }
      };

      this.eventSource.onerror = () => {
        this.connected = false;
        // Reconnect after 5 seconds
        setTimeout(() => this.connectSSE(), 5000);
      };

      this.eventSource.onopen = () => {
        this.connected = true;
      };
    },

    formatTime(ts) {
      if (!ts) return '-';
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour12: false }) + ' ' +
             d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    detailPrefix(entry) {
      switch (entry.tool_name) {
        case 'Bash': return '$ ';
        case 'Read': return '> ';
        case 'Write': case 'Edit': return '~ ';
        case 'Glob': return '? ';
        case 'WebFetch': return '@ ';
        default: return '';
      }
    }
  };
}
