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
    statsInterval: null,

    // Auth state
    token: sessionStorage.getItem('auth_token'),
    username: sessionStorage.getItem('auth_username'),
    showLogin: false,
    loginUsername: '',
    loginPassword: '',
    loginError: '',

    async init() {
      // Check if auth is required
      await this.checkAuth();

      if (this.showLogin) return; // Wait for login

      await this.initDashboard();
    },

    async checkAuth() {
      try {
        const res = await fetch('/api/auth/me', {
          headers: this.token ? { 'Authorization': `Bearer ${this.token}` } : {}
        });
        const data = await res.json();

        if (!data.authRequired) {
          // Auth disabled on server, proceed freely
          this.showLogin = false;
          return;
        }

        if (data.username) {
          // Token is valid
          this.username = data.username;
          this.showLogin = false;
        } else {
          // Need to login
          this.token = null;
          this.username = null;
          sessionStorage.removeItem('auth_token');
          sessionStorage.removeItem('auth_username');
          this.showLogin = true;
        }
      } catch {
        // Server unreachable, try without auth
        this.showLogin = false;
      }
    },

    async initDashboard() {
      await Promise.all([
        this.fetchHealth(),
        this.fetchStats(),
        this.fetchPolicies(),
        this.fetchAudit(),
        this.fetchViolations(),
      ]);
      this.connectSSE();

      // Refresh stats every 30 seconds (clear previous interval to avoid stacking)
      if (this.statsInterval) clearInterval(this.statsInterval);
      this.statsInterval = setInterval(() => this.fetchStats(), 30000);
    },

    async login() {
      this.loginError = '';
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: this.loginUsername, password: this.loginPassword })
        });

        if (res.ok) {
          const data = await res.json();
          this.token = data.token;
          this.username = data.username;
          sessionStorage.setItem('auth_token', data.token);
          sessionStorage.setItem('auth_username', data.username);
          this.showLogin = false;
          this.loginPassword = '';
          await this.initDashboard();
        } else {
          const data = await res.json();
          this.loginError = data.error || 'Login failed';
        }
      } catch {
        this.loginError = 'Cannot connect to server';
      }
    },

    logout() {
      if (this.token) {
        fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` }
        }).catch(() => {});
      }
      this.token = null;
      this.username = null;
      sessionStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_username');
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      if (this.statsInterval) {
        clearInterval(this.statsInterval);
        this.statsInterval = null;
      }
      this.showLogin = true;
    },

    async apiFetch(url, options = {}) {
      if (this.token) {
        options.headers = {
          ...options.headers,
          'Authorization': `Bearer ${this.token}`
        };
      }
      const res = await fetch(url, options);
      if (res.status === 401 && this.token) {
        // Token expired or invalid
        this.token = null;
        this.username = null;
        sessionStorage.removeItem('auth_token');
        sessionStorage.removeItem('auth_username');
        this.showLogin = true;
      }
      return res;
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
        const res = await this.apiFetch('/api/audit/stats');
        if (res.ok) this.stats = await res.json();
      } catch { /* ignore */ }
    },

    async fetchPolicies() {
      try {
        const res = await this.apiFetch('/api/policies');
        if (res.ok) {
          const data = await res.json();
          this.policies = data.policies.map(p => ({ ...p, _expanded: false }));
        }
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
        const res = await this.apiFetch('/api/audit?' + params.toString());
        if (res.ok) {
          const data = await res.json();
          this.auditEntries = data.entries.map(e => ({ ...e, _expanded: false }));
          this.auditTotal = data.total;
        }
      } catch { /* ignore */ }
    },

    async fetchViolations() {
      try {
        const res = await this.apiFetch('/api/audit?limit=20&decision=deny');
        const res2 = await this.apiFetch('/api/audit?limit=20&decision=block');
        const res3 = await this.apiFetch('/api/audit?limit=20&decision=warn');

        if (res.ok && res2.ok && res3.ok) {
          const denyData = await res.json();
          const blockData = await res2.json();
          const warnData = await res3.json();

          this.violations = [...denyData.entries, ...blockData.entries, ...warnData.entries]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 20);
        }
      } catch { /* ignore */ }
    },

    async togglePolicy(name) {
      try {
        const res = await this.apiFetch(`/api/policies/${encodeURIComponent(name)}/toggle`, { method: 'PATCH' });
        if (res.ok) {
          const data = await res.json();
          const policy = this.policies.find(p => p.name === name);
          if (policy) policy.enabled = data.enabled;
          await this.fetchStats();
        }
      } catch { /* ignore */ }
    },

    async reloadPolicies() {
      try {
        await this.apiFetch('/api/policies/reload', { method: 'POST' });
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
      if (this.eventSource) {
        this.eventSource.close();
      }

      // SSE (EventSource) doesn't support custom headers, pass token via query param
      const url = this.token
        ? `/api/audit/stream?token=${encodeURIComponent(this.token)}`
        : '/api/audit/stream';

      this.eventSource = new EventSource(url);
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
        // Don't reconnect if on login screen
        if (this.showLogin) return;
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
