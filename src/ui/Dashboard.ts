import { 
  BrokerConfig, 
  RiskConfig, 
  StrategyConfig, 
  StrategyType, 
  BrokerType,
  ExecutionMode,
  Trade,
  Position,
  LogEntry,
  BacktestReport,
  PerformanceReview
} from '../core/Types';
import { Simulator } from '../core/Simulator';

export class Dashboard {
  private container: HTMLElement;
  private activeSymbol: string = 'BTC/USD';

  // Event handlers to communicate with main.ts
  private onStartStopHandler: ((running: boolean) => void) | null = null;
  private onKillHandler: (() => void) | null = null;
  private onConfigChangeHandler: ((broker: BrokerConfig, risk: RiskConfig, strategy: StrategyConfig) => void) | null = null;
  private onAssetChangeHandler: ((symbol: string) => void) | null = null;
  private onBacktestHandler: ((days: number) => Promise<BacktestReport>) | null = null;
  private onGenerateReviewHandler: (() => Promise<PerformanceReview>) | null = null;
  private onQuickOrderHandler: ((side: 'BUY' | 'SELL') => void) | null = null;
  private onAltonToggleHandler: ((enabled: boolean) => void) | null = null;

  constructor(containerId: string, _simulator: any) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Mount element #${containerId} not found.`);
    this.container = el;
  }

  // Bind UI commands
  bindStartStop(cb: (running: boolean) => void) { this.onStartStopHandler = cb; }
  bindKill(cb: () => void) { this.onKillHandler = cb; }
  bindConfigChange(cb: any) { this.onConfigChangeHandler = cb; }
  bindAssetChange(cb: (symbol: string) => void) { this.onAssetChangeHandler = cb; }
  bindBacktest(cb: (days: number) => Promise<BacktestReport>) { this.onBacktestHandler = cb; }
  bindGenerateReview(cb: () => Promise<PerformanceReview>) { this.onGenerateReviewHandler = cb; }
  bindQuickOrder(cb: (side: 'BUY' | 'SELL') => void) { this.onQuickOrderHandler = cb; }
  bindAltonToggle(cb: (enabled: boolean) => void) { this.onAltonToggleHandler = cb; }

  // Initial markup mounting
  mount() {
    // 1. Recover configurations from localStorage
    const cachedBroker = this.getSavedBroker();
    const cachedRisk = this.getSavedRisk();
    const cachedStrategy = this.getSavedStrategy();

    // 2. Render layout HTML
    const hour = new Date().getHours();
    let greeting = "Good morning";
    if (hour >= 12 && hour < 18) greeting = "Good afternoon";
    else if (hour >= 18) greeting = "Good evening";

    this.container.innerHTML = `
      <header class="app-header" role="banner">
        <div class="brand">
          <div class="brand-logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275z"/>
            </svg>
          </div>
          <div style="display: flex; flex-direction: column;">
            <h1 class="brand-title" style="font-size: 15px; font-weight: 600; color: #fff; line-height: 1.2;">${greeting}, Reamogetswe 👋</h1>
            <span id="market-status-greeting" style="font-size: 13px; color: var(--text-secondary); margin-top: 1px;">Markets are moderately bullish today.</span>
          </div>
        </div>
        <div class="header-actions">
          <div class="status-badge">
            <span id="status-dot" class="status-dot paused"></span>
            <span id="status-text" class="status-text-label">Paused</span>
          </div>
          <button id="btn-kill" class="btn btn-danger" aria-label="Liquidate all positions immediately" style="padding: 8px 16px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            Emergency Kill
          </button>
        </div>
      </header>

      <section class="stats-bar" aria-label="Account Summary Metrics">
        <div class="stat-card glass-panel">
          <span class="stat-label">Net Asset Value</span>
          <span id="stat-nav" class="stat-value">$100,000.00</span>
          <span id="stat-nav-change" class="stat-change neutral">0.00%</span>
        </div>
        <div class="stat-card glass-panel">
          <span class="stat-label">Available Cash</span>
          <span id="stat-cash" class="stat-value">$100,000.00</span>
          <span style="font-size:11px; color:var(--text-muted); margin-top: 4px;">Buying Power</span>
        </div>
        <div class="stat-card glass-panel">
          <span class="stat-label">Active Positions</span>
          <span id="stat-positions" class="stat-value">0</span>
          <span style="font-size:11px; color:var(--text-muted); margin-top: 4px;">Open Holdings</span>
        </div>
        <div class="stat-card glass-panel">
          <span class="stat-label">Realized PnL</span>
          <span id="stat-pnl-realized" class="stat-value">$0.00</span>
          <span id="stat-pnl-realized-change" class="stat-change neutral">-$</span>
        </div>
        <div class="stat-card glass-panel">
          <span class="stat-label">Win Rate</span>
          <span id="stat-winrate" class="stat-value">0.0%</span>
          <span style="font-size:11px; color:var(--text-muted); margin-top: 4px;">Success Ratio</span>
        </div>
      </section>

      <main class="workspace-grid">
        <section class="main-display">
          <!-- Chart -->
          <div class="chart-card glass-panel">
            <header class="chart-header">
              <h2 id="chart-asset-title">BTC/USD Live Feed</h2>
              <div class="indicator-panel" id="live-indicator-values">
                <!-- Indicators populated here -->
              </div>
            </header>
            <div id="trading-chart" class="chart-container"></div>
          </div>

          <!-- 3-Column Bottom Grid Layout -->
          <div class="bottom-grid">
            <!-- Column 1: AI Insight & Sentiment -->
            <div class="bottom-col">
              <h3 class="section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                AI Insight & Sentiment
              </h3>
              
              <!-- Son of Alton Panel -->
              <div class="config-section" style="flex: 1; display: flex; flex-direction: column; gap: 14px;">
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255,255,255,0.01); border-radius: 12px; border: 1px solid var(--border-light);">
                  <div>
                    <strong style="color: var(--color-primary); font-size: 13px; font-weight:600; display: block;">Son of Alton Optimizer</strong>
                    <span style="font-size: 11px; color: var(--text-muted);">Enables autonomous real-time parameter tuning</span>
                  </div>
                  <label class="switch-container">
                    <input type="checkbox" id="checkbox-alton-toggle" style="opacity: 0; width: 0; height: 0;">
                    <span class="switch-slider"></span>
                  </label>
                </div>

                <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 8px; overflow: hidden;">
                  <span class="stat-label" style="font-size:11px;">AI Optimization Decisions</span>
                  <div id="alton-terminal-log" class="log-viewer" style="flex-grow: 1; overflow-y: auto;">
                    <div class="log-entry"><span class="log-time">[System]</span> <span class="log-level info">AI</span> <span class="log-msg">Son of Alton idle. Enable the toggle to activate parameter auditing.</span></div>
                  </div>
                </div>

                <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 8px; overflow: hidden;">
                  <span class="stat-label" style="font-size:11px;">Market News & Sentiment Scans</span>
                  <div id="alton-sentiment-viewer" class="log-viewer" style="flex-grow: 1; overflow-y: auto; background: rgba(0, 0, 0, 0.45); padding: 12px; display: flex; flex-direction: column; gap: 10px;">
                    <em style="color: var(--text-muted); font-size: 13px;">Waiting for sentiment audit scans to parse news feed...</em>
                  </div>
                </div>

                <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 8px; overflow: hidden;">
                  <span class="stat-label" style="font-size:11px;">Latest Progress Report</span>
                  <div id="alton-report-viewer" class="log-viewer" style="flex-grow: 1; overflow-y: auto; background: rgba(0, 0, 0, 0.45); line-height: 1.6; font-family: var(--font-sans); font-size: 13px; padding: 16px; color: var(--text-secondary);">
                    <em style="color: var(--text-muted);">No reports compiled yet. Auditing must run for 3 simulated cycles to generate report cards.</em>
                  </div>
                </div>
              </div>
            </div>

            <!-- Column 2: Trade Ledger & Performance -->
            <div class="bottom-col">
              <h3 class="section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                Ledger & Performance
              </h3>

              <!-- Backtest Panel -->
              <div class="config-section" style="padding: 16px;">
                <h4 style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                  Backtesting Suite 
                  <span id="backtest-scope-badge" style="font-size: 11px; color: var(--color-primary);">[BTC/USD]</span>
                </h4>
                <div style="display: flex; gap: 12px; align-items: flex-end;">
                  <div class="input-group" style="flex: 1;">
                    <label for="input-backtest-days">History Scope (Days)</label>
                    <input type="number" id="input-backtest-days" value="180" min="30" max="730">
                  </div>
                  <button id="btn-backtest" class="btn btn-secondary" style="padding: 10px 16px;">Run Backtest</button>
                </div>
              </div>

              <!-- Metrics Summary -->
              <div class="config-section" style="padding: 16px;">
                <span class="stat-label" style="font-size:11px; display:block; margin-bottom:10px;">Self-Review Performance</span>
                <div class="perf-metrics-grid" style="margin-bottom: 12px;">
                  <div class="perf-metric-box">
                    <span class="stat-label" style="font-size: 11px;">Profit Factor</span>
                    <span id="perf-factor" class="perf-metric-val">0.00</span>
                  </div>
                  <div class="perf-metric-box">
                    <span class="stat-label" style="font-size: 11px;">Win Rate</span>
                    <span id="perf-winrate" class="perf-metric-val">0.0%</span>
                  </div>
                  <div class="perf-metric-box">
                    <span class="stat-label" style="font-size: 11px;">Avg Win</span>
                    <span id="perf-avgwin" class="perf-metric-val">$0.00</span>
                  </div>
                  <div class="perf-metric-box">
                    <span class="stat-label" style="font-size: 11px;">Avg Loss</span>
                    <span id="perf-avgloss" class="perf-metric-val">$0.00</span>
                  </div>
                </div>
                <div id="perf-recommendations-list">
                  <div class="rec-item">Trade ledger is currently empty. Run backtests or trade paper accounts to generate analytical recommendation reports.</div>
                </div>
              </div>

              <!-- Trade Ledger List -->
              <div class="config-section" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: var(--spacing-sm);">
                <span class="stat-label" style="font-size:11px; margin-bottom:8px; display:block;">Recent Trade Executions</span>
                <div class="data-table-wrapper" style="flex: 1; overflow-y: auto;">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Trade ID</th>
                        <th>Type</th>
                        <th>Asset</th>
                        <th>Shares</th>
                        <th>Fill Price</th>
                        <th>Total Cost</th>
                        <th>PnL</th>
                      </tr>
                    </thead>
                    <tbody id="ledger-rows">
                      <tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">No trades executed in this session.</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- Column 3: Config & Watchlist -->
            <div class="bottom-col">
              <h3 class="section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                System Config & Watchlist
              </h3>

              <!-- Watchlist -->
              <div class="config-section" style="padding: var(--spacing-sm);">
                <span class="stat-label" style="font-size:11px; margin-bottom:8px; display:block;">Watchlist Overview</span>
                <table class="watchlist-table">
                  <tbody id="watchlist-rows-container">
                    <!-- Loaded dynamically by renderWatchlist -->
                  </tbody>
                </table>
              </div>

              <!-- Quick Order -->
              <div class="config-section" style="padding: 16px;">
                <h4 style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                  Quick Market Trade
                  <span id="quick-scope-badge" style="font-size: 11px; color: var(--color-primary);">[BTC/USD]</span>
                </h4>
                <div class="control-buttons-row">
                  <button id="btn-quick-buy" class="btn btn-success" style="padding: 10px 16px;">Market BUY</button>
                  <button id="btn-quick-sell" class="btn btn-danger" style="padding: 10px 16px;">Market SELL</button>
                </div>
              </div>

              <!-- Connection Panel -->
              <div class="config-section">
                <span class="stat-label" style="font-size:11px;">Broker Account Settings</span>
                <div class="input-group">
                  <label for="select-broker">Trading Broker</label>
                  <select id="select-broker">
                    <option value="simulator" ${cachedBroker.type === 'simulator' ? 'selected' : ''}>Local Simulator (Safe)</option>
                    <option value="alpaca-paper" ${cachedBroker.type === 'alpaca-paper' ? 'selected' : ''}>Alpaca Paper Sandbox</option>
                    <option value="alpaca-live" ${cachedBroker.type === 'alpaca-live' ? 'selected' : ''}>Alpaca Live Account</option>
                  </select>
                </div>
                <div id="alpaca-keys-wrapper" style="display: ${cachedBroker.type === 'simulator' ? 'none' : 'flex'}; flex-direction: column; gap: 12px;">
                  <div class="input-group">
                    <label for="input-api-key">API Key ID</label>
                    <input type="text" id="input-api-key" placeholder="APCA-API-KEY-ID" value="${cachedBroker.apiKey}">
                  </div>
                  <div class="input-group">
                    <label for="input-api-secret">API Secret Key</label>
                    <input type="password" id="input-api-secret" placeholder="API Secret" value="${cachedBroker.apiSecret}">
                  </div>
                </div>
              </div>

              <!-- Risk Panel -->
              <div class="config-section">
                <span class="stat-label" style="font-size:11px; display: flex; justify-content: space-between; align-items: center;">
                  Asset Risk Limits
                  <span id="risk-scope-badge" style="color: var(--color-primary);">[BTC/USD]</span>
                </span>
                <div class="input-group">
                  <label for="select-mode">Execution Mode</label>
                  <select id="select-mode">
                    <option value="advisor" ${cachedRisk.executionMode === 'advisor' ? 'selected' : ''}>Advisor (Manual Confirms)</option>
                    <option value="autopilot" ${cachedRisk.executionMode === 'autopilot' ? 'selected' : ''}>Autopilot (Fully Automated)</option>
                  </select>
                </div>
                <div class="input-group">
                  <label for="input-max-pos-size">Max Order Allocation ($)</label>
                  <input type="number" id="input-max-pos-size" value="${cachedRisk.maxPositionSize}" min="10" step="50">
                </div>
                <div class="input-group">
                  <label for="input-max-positions">Max Open Positions (Global)</label>
                  <input type="number" id="input-max-positions" value="${cachedRisk.maxPositions}" min="1" max="10">
                </div>
                <div class="input-group">
                  <label for="input-stop-loss">Daily Stop Loss Limit (%)</label>
                  <input type="number" id="input-stop-loss" value="${cachedRisk.dailyStopLossPct}" min="1" max="20" step="0.5">
                </div>
                <div class="input-group">
                  <label for="input-pos-stop-loss">Position Stop Loss (%)</label>
                  <input type="number" id="input-pos-stop-loss" value="${cachedRisk.positionStopLossPct || 2.0}" min="0.5" max="10" step="0.1">
                </div>
                <div class="input-group">
                  <label for="input-pos-take-profit">Position Take Profit (%)</label>
                  <input type="number" id="input-pos-take-profit" value="${cachedRisk.positionTakeProfitPct || 5.0}" min="0.5" max="30" step="0.5">
                </div>
              </div>

              <!-- Strategy Panel -->
              <div class="config-section">
                <span class="stat-label" style="font-size:11px; display: flex; justify-content: space-between; align-items: center;">
                  Strategy Parameters
                  <span id="strategy-scope-badge" style="color: var(--color-primary);">[BTC/USD]</span>
                </span>
                <div class="input-group">
                  <label for="select-strategy">Active Logic</label>
                  <select id="select-strategy">
                    <option value="sma_crossover" ${cachedStrategy.type === 'sma_crossover' ? 'selected' : ''}>SMA Crossover</option>
                    <option value="rsi_mean_reversion" ${cachedStrategy.type === 'rsi_mean_reversion' ? 'selected' : ''}>RSI Mean Reversion</option>
                    <option value="macd" ${cachedStrategy.type === 'macd' ? 'selected' : ''}>MACD Convergence</option>
                    <option value="bollinger_bands" ${cachedStrategy.type === 'bollinger_bands' ? 'selected' : ''}>Bollinger Bands</option>
                    <option value="ml_predict" ${cachedStrategy.type === 'ml_predict' ? 'selected' : ''}>Python ML Predictor (AI)</option>
                  </select>
                </div>
                <div id="strategy-sliders" style="display: flex; flex-direction: column; gap: var(--spacing-sm); margin-top: 8px;">
                  <!-- Filled dynamically -->
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <!-- Active Control Row (Fixed at bottom) -->
      <footer class="glass-panel" style="padding: 16px var(--spacing-md); display: flex; justify-content: flex-end;" role="contentinfo">
        <div class="control-buttons-row" style="width: 240px;">
          <button id="btn-start" class="btn btn-success" style="width: 100%;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Start Trading Bot
          </button>
        </div>
      </footer>

      <!-- Advisor Modal Prompt -->
      <div id="advisor-modal-overlay" class="modal-overlay">
        <div class="modal-content">
          <header class="modal-header">
            <h3 class="modal-title" id="advisor-modal-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              Manual Confirmation
            </h3>
          </header>
          <div class="modal-body">
            <p id="advisor-prompt-text">The bot triggers a buy signal in BTC/USD.</p>
            <div style="padding: var(--spacing-sm); margin-top: 12px; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--border-light); background: var(--bg-primary); border-radius: 12px;">
              <div>
                <span class="stat-label" style="display: block; font-size:11px;">Asset & Qty</span>
                <strong id="advisor-modal-shares" style="font-size: 15px; font-family: var(--font-mono); color: var(--text-main);">0.00 BTC/USD</strong>
              </div>
              <div style="text-align: right;">
                <span class="stat-label" style="display: block; font-size:11px;">Trigger Price</span>
                <strong id="advisor-modal-price" style="font-size: 15px; font-family: var(--font-mono); color: var(--color-success);">$0.00</strong>
              </div>
            </div>
          </div>
          <footer class="modal-footer">
            <button id="advisor-btn-cancel" class="btn btn-secondary">Dismiss Signal</button>
            <button id="advisor-btn-confirm" class="btn btn-primary">Approve Trade</button>
          </footer>
        </div>
      </div>
    `;

    // 3. Setup event listeners
    this.setupListeners();
    this.renderStrategySliders();
    this.triggerConfigChange();
  }

  // Plays custom synthesized sound chimes using browser AudioContext
  private playChime(type: 'buy' | 'sell' | 'alert') {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === 'buy') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime); 
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25); 
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      } else if (type === 'sell') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); 
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.25); 
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      } else {
        // Double-beep warning
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); 
        osc.frequency.setValueAtTime(587.33, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.1, ctx.currentTime + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      }
    } catch (e) {
      console.warn('Browser AudioContext sound playback blocked', e);
    }
  }

  // Setup DOM Event Listeners
  private setupListeners() {
    const selectBroker = document.getElementById('select-broker') as HTMLSelectElement;
    const alpacaKeysWrapper = document.getElementById('alpaca-keys-wrapper') as HTMLDivElement;
    const selectStrategy = document.getElementById('select-strategy') as HTMLSelectElement;
    
    // Config change listeners
    // Quick Market Trades
    document.getElementById('btn-quick-buy')?.addEventListener('click', () => {
      if (this.onQuickOrderHandler) this.onQuickOrderHandler('BUY');
    });

    document.getElementById('btn-quick-sell')?.addEventListener('click', () => {
      if (this.onQuickOrderHandler) this.onQuickOrderHandler('SELL');
    });

    selectBroker.addEventListener('change', () => {
      const showKeys = selectBroker.value !== 'simulator';
      alpacaKeysWrapper.style.display = showKeys ? 'flex' : 'none';
      this.triggerConfigChange();
    });

    ['input-api-key', 'input-api-secret', 'select-mode', 'input-max-pos-size', 'input-max-positions', 'input-stop-loss', 'input-pos-stop-loss', 'input-pos-take-profit']
      .forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => this.triggerConfigChange());
      });

    selectStrategy.addEventListener('change', () => {
      this.renderStrategySliders();
      this.triggerConfigChange();
    });

    // Start / Pause
    const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
    btnStart.addEventListener('click', () => {
      const isRunning = btnStart.classList.contains('btn-danger'); // Click toggles state
      if (isRunning) {
        // Pause
        btnStart.classList.remove('btn-danger');
        btnStart.classList.add('btn-success');
        btnStart.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Trading Bot`;
        
        // Update header badges
        const dot = document.getElementById('status-dot')!;
        dot.className = 'status-dot paused';
        document.getElementById('status-text')!.innerText = 'Paused';

        if (this.onStartStopHandler) this.onStartStopHandler(false);
      } else {
        // Start
        btnStart.classList.remove('btn-success');
        btnStart.classList.add('btn-danger');
        btnStart.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause Robot`;
        
        // Update header badges
        const dot = document.getElementById('status-dot')!;
        dot.className = 'status-dot active';
        document.getElementById('status-text')!.innerText = 'Active';

        if (this.onStartStopHandler) this.onStartStopHandler(true);
      }
    });

    // Emergency Kill
    document.getElementById('btn-kill')?.addEventListener('click', () => {
      this.playChime('alert');
      if (confirm('Are you sure you want to trigger the Emergency Kill Switch? This will liquidate ALL positions immediately.')) {
        if (this.onKillHandler) this.onKillHandler();
      }
    });

    // Backtest Button
    document.getElementById('btn-backtest')?.addEventListener('click', async () => {
      const days = parseInt((document.getElementById('input-backtest-days') as HTMLInputElement).value) || 180;
      const btn = document.getElementById('btn-backtest') as HTMLButtonElement;
      
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = 'Running...';
      
      try {
        if (this.onBacktestHandler) {
          const report = await this.onBacktestHandler(days);
          this.showBacktestReport(report);
          
          // Switch to performance tab to show report
          this.switchTab('tab-performance', 'pane-performance');
        }
      } catch (e: any) {
        alert(`Backtest error: ${e.message}`);
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    });

    // Son of Alton toggle checkbox
    const checkboxAlton = document.getElementById('checkbox-alton-toggle') as HTMLInputElement;
    checkboxAlton?.addEventListener('change', () => {
      if (this.onAltonToggleHandler) {
        this.onAltonToggleHandler(checkboxAlton.checked);
      }
    });

    // Tab buttons switching
    const tabSelectors = [
      { tabId: 'tab-log', paneId: 'pane-log' },
      { tabId: 'tab-ledger', paneId: 'pane-ledger' },
      { tabId: 'tab-performance', paneId: 'pane-performance' },
      { tabId: 'tab-alton', paneId: 'pane-alton' }
    ];

    tabSelectors.forEach(ts => {
      document.getElementById(ts.tabId)?.addEventListener('click', () => {
        this.switchTab(ts.tabId, ts.paneId);
        if (ts.tabId === 'tab-performance') {
          this.triggerPerformanceReview();
        }
      });
    });
  }

  // Switch tabs in workspace bottom card
  private switchTab(tabId: string, paneId: string) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });

    const activeTab = document.getElementById(tabId)!;
    activeTab.classList.add('active');
    activeTab.setAttribute('aria-selected', 'true');
    document.getElementById(paneId)!.classList.add('active');
  }

  // Triggers self review calculations
  private async triggerPerformanceReview() {
    if (this.onGenerateReviewHandler) {
      const review = await this.onGenerateReviewHandler();
      
      // Update UI
      document.getElementById('perf-factor')!.innerText = review.profitFactor.toFixed(2);
      document.getElementById('perf-winrate')!.innerText = `${review.winRate.toFixed(1)}%`;
      document.getElementById('perf-avgwin')!.innerText = `$${review.avgWin.toFixed(2)}`;
      document.getElementById('perf-avgloss')!.innerText = `$${review.avgLoss.toFixed(2)}`;

      const list = document.getElementById('perf-recommendations-list')!;
      if (review.recommendations.length > 0) {
        list.innerHTML = review.recommendations.map(r => {
          const isWarning = r.includes('Warning') || r.includes('Critical');
          return `<div class="rec-item ${isWarning ? 'warning' : 'success'}">${r}</div>`;
        }).join('');
      } else {
        list.innerHTML = `<div class="rec-item">No recommendation reports compiled yet. Keep trading to accumulate historical metrics.</div>`;
      }
    }
  }

  // Render the watchlist in the sidebar dynamically
  public renderWatchlist(activeSymbol: string, prices: Map<string, number>, activeBots: Map<string, boolean>) {
    const container = document.getElementById('watchlist-rows-container');
    if (!container) return;

    container.innerHTML = Simulator.assets.map(asset => {
      const price = prices.get(asset.symbol) || asset.defaultPrice;
      const isChartActive = asset.symbol === activeSymbol;
      const isBotActive = activeBots.get(asset.symbol) || false;
      
      const changePct = ((price - asset.defaultPrice) / asset.defaultPrice) * 100;
      const changeText = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
      const changeClass = changePct >= 0 ? 'positive' : 'negative';

      let logo = '📈';
      if (asset.symbol === 'BTC/USD') logo = '₿';
      else if (asset.symbol === 'ETH/USD') logo = 'Ξ';
      else if (asset.symbol === 'SOL/USD') logo = '◎';
      else if (asset.symbol === 'DOGE/USD') logo = 'Ð';
      else if (asset.symbol === 'LTC/USD') logo = 'Ł';
      else if (asset.symbol === 'AAPL') logo = '';
      else if (asset.symbol === 'TSLA') logo = '⚡';
      else if (asset.symbol === 'NVDA') logo = '🟢';
      else if (asset.symbol === 'MSFT') logo = '❖';
      else if (asset.symbol === 'GOOGL') logo = 'G';

      const sparkColor = changePct >= 0 ? '#22C55E' : '#EF4444';
      const sparkPath = changePct >= 0
        ? 'M0,14 Q8,2 14,10 T24,3 T34,8 T44,2'
        : 'M0,2 Q8,14 14,6 T24,15 T34,8 T44,14';
      const sparklineSvg = `
        <svg width="45" height="16" viewBox="0 0 45 16" fill="none" style="margin-right: 8px; opacity:0.85;">
          <path d="${sparkPath}" stroke="${sparkColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;

      return `
        <tr class="watchlist-row ${isChartActive ? 'active' : ''}" data-symbol="${asset.symbol}">
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 24px; height: 24px; border-radius: 6px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-light); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: var(--color-primary);">${logo}</div>
              <div class="ticker-info">
                <span class="ticker-symbol">${asset.symbol}</span>
                <span class="ticker-name">${asset.name.split(' ')[0]}</span>
              </div>
            </div>
          </td>
          <td style="text-align: right;">
            ${sparklineSvg}
          </td>
          <td>
            <div class="ticker-price">$${price.toLocaleString('en-US', { minimumFractionDigits: price < 1 ? 4 : 2, maximumFractionDigits: price < 1 ? 4 : 2 })}</div>
            <div class="stat-change ${changeClass}" style="font-size:11px; justify-content: flex-end; margin-top:2px;">${changeText}</div>
          </td>
          <td>
            <div class="ticker-change-badge">
              <span class="ticker-status">
                <span class="bot-dot ${isBotActive ? 'active' : ''}"></span>
                <span style="font-size:11px; color:var(--text-muted);">${isBotActive ? 'BOT' : 'OFF'}</span>
              </span>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Attach click listeners to rows to swap chart asset
    container.querySelectorAll('.watchlist-row').forEach(row => {
      row.addEventListener('click', () => {
        const symbol = row.getAttribute('data-symbol')!;
        
        // Update badges text
        document.getElementById('risk-scope-badge')!.innerText = `[${symbol}]`;
        document.getElementById('strategy-scope-badge')!.innerText = `[${symbol}]`;
        document.getElementById('quick-scope-badge')!.innerText = `[${symbol}]`;
        document.getElementById('backtest-scope-badge')!.innerText = `[${symbol}]`;

        if (this.onAssetChangeHandler) {
          this.onAssetChangeHandler(symbol);
        }
      });
    });
  }

  // Swaps config panel values when chart swaps asset
  public setConfigs(strategy: StrategyConfig, risk: RiskConfig, symbol: string) {
    this.activeSymbol = symbol;
    // Mode
    (document.getElementById('select-mode') as HTMLSelectElement).value = risk.executionMode;
    // Limits
    (document.getElementById('input-max-pos-size') as HTMLInputElement).value = risk.maxPositionSize.toString();
    (document.getElementById('input-max-positions') as HTMLInputElement).value = risk.maxPositions.toString();
    (document.getElementById('input-stop-loss') as HTMLInputElement).value = risk.dailyStopLossPct.toString();
    (document.getElementById('input-pos-stop-loss') as HTMLInputElement).value = risk.positionStopLossPct.toString();
    (document.getElementById('input-pos-take-profit') as HTMLInputElement).value = risk.positionTakeProfitPct.toString();

    // Strategy select
    (document.getElementById('select-strategy') as HTMLSelectElement).value = strategy.type;
    
    // Sliders
    this.renderStrategySlidersWithValues(strategy);

    // Update scope labels
    document.getElementById('risk-scope-badge')!.innerText = `[${symbol}]`;
    document.getElementById('strategy-scope-badge')!.innerText = `[${symbol}]`;
    document.getElementById('quick-scope-badge')!.innerText = `[${symbol}]`;
    document.getElementById('backtest-scope-badge')!.innerText = `[${symbol}]`;
  }

  // Renders sliders dynamically depending on strategy selected
  private renderStrategySliders() {
    const strategy = (document.getElementById('select-strategy') as HTMLSelectElement).value as StrategyType;
    const cachedStrategy = this.getSavedStrategy();
    
    const config: StrategyConfig = {
      type: strategy,
      parameters: {
        ...cachedStrategy.parameters
      }
    };
    this.renderStrategySlidersWithValues(config);
  }

  private renderStrategySlidersWithValues(config: StrategyConfig) {
    const container = document.getElementById('strategy-sliders')!;
    let html = '';

    if (config.type === 'sma_crossover') {
      const fast = config.parameters.smaFastPeriod || 10;
      const slow = config.parameters.smaSlowPeriod || 30;
      html = `
        <div class="input-group">
          <label>Fast SMA Period</label>
          <div class="range-slider">
            <input type="range" id="slider-sma-fast" min="3" max="50" value="${fast}">
            <span class="slider-val" id="val-sma-fast">${fast}</span>
          </div>
        </div>
        <div class="input-group">
          <label>Slow SMA Period</label>
          <div class="range-slider">
            <input type="range" id="slider-sma-slow" min="15" max="100" value="${slow}">
            <span class="slider-val" id="val-sma-slow">${slow}</span>
          </div>
        </div>
      `;
    } else if (config.type === 'rsi_mean_reversion') {
      const period = config.parameters.rsiPeriod || 14;
      const oversold = config.parameters.rsiOversold || 30;
      const overbought = config.parameters.rsiOverbought || 70;
      html = `
        <div class="input-group">
          <label>RSI Period</label>
          <div class="range-slider">
            <input type="range" id="slider-rsi-period" min="5" max="30" value="${period}">
            <span class="slider-val" id="val-rsi-period">${period}</span>
          </div>
        </div>
        <div class="input-group">
          <label>RSI Oversold (Buy Threshold)</label>
          <div class="range-slider">
            <input type="range" id="slider-rsi-oversold" min="10" max="45" value="${oversold}">
            <span class="slider-val" id="val-rsi-oversold">${oversold}</span>
          </div>
        </div>
        <div class="input-group">
          <label>RSI Overbought (Sell Threshold)</label>
          <div class="range-slider">
            <input type="range" id="slider-rsi-overbought" min="55" max="90" value="${overbought}">
            <span class="slider-val" id="val-rsi-overbought">${overbought}</span>
          </div>
        </div>
      `;
    } else if (config.type === 'macd') {
      const fast = config.parameters.macdFastPeriod || 12;
      const slow = config.parameters.macdSlowPeriod || 26;
      const sig = config.parameters.macdSignalPeriod || 9;
      html = `
        <div class="input-group">
          <label>MACD Fast Period</label>
          <div class="range-slider">
            <input type="range" id="slider-macd-fast" min="5" max="25" value="${fast}">
            <span class="slider-val" id="val-macd-fast">${fast}</span>
          </div>
        </div>
        <div class="input-group">
          <label>MACD Slow Period</label>
          <div class="range-slider">
            <input type="range" id="slider-macd-slow" min="20" max="60" value="${slow}">
            <span class="slider-val" id="val-macd-slow">${slow}</span>
          </div>
        </div>
        <div class="input-group">
          <label>MACD Signal Period</label>
          <div class="range-slider">
            <input type="range" id="slider-macd-sig" min="5" max="20" value="${sig}">
            <span class="slider-val" id="val-macd-sig">${sig}</span>
          </div>
        </div>
      `;
    } else if (config.type === 'bollinger_bands') {
      const period = config.parameters.bbPeriod || 20;
      const mult = config.parameters.bbMultiplier || 2.0;
      html = `
        <div class="input-group">
          <label>BB Period</label>
          <div class="range-slider">
            <input type="range" id="slider-bb-period" min="5" max="50" value="${period}">
            <span class="slider-val" id="val-bb-period">${period}</span>
          </div>
        </div>
        <div class="input-group">
          <label>BB Standard Deviation Multiplier</label>
          <div class="range-slider">
            <input type="range" id="slider-bb-multiplier" min="1.0" max="4.0" step="0.1" value="${mult}">
            <span class="slider-val" id="val-bb-multiplier">${mult}</span>
          </div>
        </div>
      `;
    } else if (config.type === 'ml_predict') {
      html = `
        <div class="input-group" style="padding: 12px; background: rgba(56, 189, 248, 0.05); border: 1px dashed var(--color-primary); border-radius: 8px; display: flex; flex-direction: column; gap: 8px;">
          <strong style="color: var(--color-primary); font-size: 0.85rem; display: block;">Python ML Strategy</strong>
          <span style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.4; display: block;">
            Queries a RandomForest ML model. Enter your ML server endpoint below (local or hosted):
          </span>
          <div class="input-group">
            <input type="text" id="input-ml-url" placeholder="http://localhost:5000" style="font-size: 0.75rem; padding: 6px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-light); border-radius: 4px; color: var(--text-main); width: 100%;" value="${localStorage.getItem('ml_url') || 'http://localhost:5000'}">
          </div>
          <button id="btn-train-ml" class="btn btn-primary" style="width: 100%; font-size: 0.8rem; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Train ML Model</button>
        </div>
      `;
    }

    container.innerHTML = html;

    // Attach range sliders update values on change
    container.querySelectorAll('input[type="range"]').forEach(input => {
      const slider = input as HTMLInputElement;
      const spanId = slider.id.replace('slider-', 'val-');
      const span = document.getElementById(spanId)!;
      
      slider.addEventListener('input', () => {
        span.innerText = slider.value;
      });
      slider.addEventListener('change', () => {
        this.triggerConfigChange();
      });
    });

    // Attach change listener to ML URL input box if it exists
    const inputMlUrl = document.getElementById('input-ml-url') as HTMLInputElement;
    if (inputMlUrl) {
      inputMlUrl.addEventListener('change', () => {
        const val = inputMlUrl.value.trim() || 'http://localhost:5000';
        localStorage.setItem('ml_url', val);
        this.triggerConfigChange();
      });
    }

    // Attach Train ML button click listener if it exists
    const btnTrain = document.getElementById('btn-train-ml');
    if (btnTrain) {
      btnTrain.addEventListener('click', async () => {
        btnTrain.setAttribute('disabled', 'true');
        btnTrain.innerText = 'Training Model...';
        
        try {
          const sym = this.activeSymbol;
          // Path to data file: data/history/Symbol_history.json
          // Note that symbol BTC/USD will have a file named BTC_USD_history.json
          const cleanSym = sym.replace('/', '_');
          const filepath = `data/history/${cleanSym}_history.json`;
          
          const mlUrl = localStorage.getItem('ml_url') || 'http://localhost:5000';
          const apiKey = (document.getElementById('input-api-key') as HTMLInputElement)?.value || '';
          const apiSecret = (document.getElementById('input-api-secret') as HTMLInputElement)?.value || '';

          const res = await fetch(`${mlUrl}/train`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              symbol: sym,
              filepath: filepath,
              apiKey: apiKey,
              apiSecret: apiSecret
            })
          });
          
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || `HTTP Error ${res.status}`);
          }
          
          alert(`Success: Trained machine learning model for ${sym}!\nAccuracy: ${(data.training_accuracy * 100).toFixed(1)}%`);
          btnTrain.innerText = 'Train ML Model (Success!)';
        } catch (e: any) {
          alert(`Training failed: ${e.message}\n\nMake sure your ML server is running, or if testing locally, download history first in your terminal:\nnode scripts/fetch_history.js ${this.activeSymbol} 365 <AlpacaKey> <AlpacaSecret>`);
          btnTrain.innerText = 'Train ML Model (Failed)';
        } finally {
          btnTrain.removeAttribute('disabled');
          setTimeout(() => {
            if (btnTrain) btnTrain.innerText = 'Train ML Model';
          }, 3000);
        }
      });
    }
  }

  // Parse inputs and push to parent coordinator
  public triggerConfigChange() {
    const selectBroker = document.getElementById('select-broker') as HTMLSelectElement;
    const apiKey = (document.getElementById('input-api-key') as HTMLInputElement).value;
    const apiSecret = (document.getElementById('input-api-secret') as HTMLInputElement).value;
    
    const brokerConfig: BrokerConfig = {
      type: selectBroker.value as BrokerType,
      apiKey,
      apiSecret
    };

    const selectMode = document.getElementById('select-mode') as HTMLSelectElement;
    const maxPosSize = parseFloat((document.getElementById('input-max-pos-size') as HTMLInputElement).value) || 1000;
    const maxPositions = parseInt((document.getElementById('input-max-positions') as HTMLInputElement).value) || 3;
    const stopLoss = parseFloat((document.getElementById('input-stop-loss') as HTMLInputElement).value) || 5;
    const posStopLoss = parseFloat((document.getElementById('input-pos-stop-loss') as HTMLInputElement).value) || 2;
    const posTakeProfit = parseFloat((document.getElementById('input-pos-take-profit') as HTMLInputElement).value) || 5;

    const riskConfig: RiskConfig = {
      executionMode: selectMode.value as ExecutionMode,
      maxPositionSize: maxPosSize,
      maxPositions,
      dailyStopLossPct: stopLoss,
      positionStopLossPct: posStopLoss,
      positionTakeProfitPct: posTakeProfit
    };

    const selectStrategy = document.getElementById('select-strategy') as HTMLSelectElement;
    const strategyType = selectStrategy.value as StrategyType;

    // Read indicators sliders values
    let smaFastPeriod = 10, smaSlowPeriod = 30;
    let rsiPeriod = 14, rsiOversold = 30, rsiOverbought = 70;
    let macdFastPeriod = 12, macdSlowPeriod = 26, macdSignalPeriod = 9;
    let bbPeriod = 20, bbMultiplier = 2.0;

    if (strategyType === 'sma_crossover') {
      smaFastPeriod = parseInt((document.getElementById('slider-sma-fast') as HTMLInputElement)?.value) || 10;
      smaSlowPeriod = parseInt((document.getElementById('slider-sma-slow') as HTMLInputElement)?.value) || 30;
    } else if (strategyType === 'rsi_mean_reversion') {
      rsiPeriod = parseInt((document.getElementById('slider-rsi-period') as HTMLInputElement)?.value) || 14;
      rsiOversold = parseInt((document.getElementById('slider-rsi-oversold') as HTMLInputElement)?.value) || 30;
      rsiOverbought = parseInt((document.getElementById('slider-rsi-overbought') as HTMLInputElement)?.value) || 70;
    } else if (strategyType === 'macd') {
      macdFastPeriod = parseInt((document.getElementById('slider-macd-fast') as HTMLInputElement)?.value) || 12;
      macdSlowPeriod = parseInt((document.getElementById('slider-macd-slow') as HTMLInputElement)?.value) || 26;
      macdSignalPeriod = parseInt((document.getElementById('slider-macd-sig') as HTMLInputElement)?.value) || 9;
    } else if (strategyType === 'bollinger_bands') {
      bbPeriod = parseInt((document.getElementById('slider-bb-period') as HTMLInputElement)?.value) || 20;
      bbMultiplier = parseFloat((document.getElementById('slider-bb-multiplier') as HTMLInputElement)?.value) || 2.0;
    }

    const strategyConfig: StrategyConfig = {
      type: strategyType,
      parameters: {
        smaFastPeriod, smaSlowPeriod,
        rsiPeriod, rsiOversold, rsiOverbought,
        macdFastPeriod, macdSlowPeriod, macdSignalPeriod,
        bbPeriod, bbMultiplier
      }
    };

    // Cache values in localStorage (note: local storage maintains last configurations globally, which acts as base default)
    localStorage.setItem('aegis_broker', JSON.stringify(brokerConfig));
    localStorage.setItem('aegis_risk', JSON.stringify(riskConfig));
    localStorage.setItem('aegis_strategy', JSON.stringify(strategyConfig));

    if (this.onConfigChangeHandler) {
      this.onConfigChangeHandler(brokerConfig, riskConfig, strategyConfig);
    }
  }

  // Update account statistics cards
  updateStats(balance: { cash: number; equity: number }, positions: Position[], trades: Trade[]) {
    // Net Value
    document.getElementById('stat-nav')!.innerText = `$${balance.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    // NAV change estimation (assuming base starts at $100,000 for local)
    const baseValue = 100000;
    const changePct = ((balance.equity - baseValue) / baseValue) * 100;
    const navChange = document.getElementById('stat-nav-change')!;
    navChange.className = `stat-change ${changePct > 0 ? 'positive' : changePct < 0 ? 'negative' : 'neutral'}`;
    navChange.innerText = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;

    // Available Cash
    document.getElementById('stat-cash')!.innerText = `$${balance.cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Positions count
    document.getElementById('stat-positions')!.innerText = positions.length.toString();

    // PnL Realized
    const sells = trades.filter(t => t.type === 'SELL');
    let realizedPnl = 0;
    sells.forEach(t => realizedPnl += (t.pnl || 0));
    
    const pnlEl = document.getElementById('stat-pnl-realized')!;
    pnlEl.innerText = `${realizedPnl >= 0 ? '' : '-'}$${Math.abs(realizedPnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    pnlEl.style.color = realizedPnl > 0 ? 'var(--color-success)' : realizedPnl < 0 ? 'var(--color-danger)' : 'var(--text-main)';

    // Win Rate
    let wins = 0;
    sells.forEach(t => { if ((t.pnl || 0) > 0) wins++; });
    const winRate = sells.length === 0 ? 0 : (wins / sells.length) * 100;
    document.getElementById('stat-winrate')!.innerText = `${winRate.toFixed(1)}%`;

    // Render Ledger Rows
    const ledger = document.getElementById('ledger-rows')!;
    if (trades.length === 0) {
      ledger.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">No trades executed in this session.</td></tr>`;
    } else {
      ledger.innerHTML = trades.map(t => {
        const dateStr = new Date(t.timestamp).toLocaleTimeString();
        const pnl = t.pnl || 0;
        let pnlText = '-';
        let pnlClass = 'neutral';
        
        if (t.type === 'SELL' || t.type === 'LIQUIDATE') {
          pnlText = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
          pnlClass = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : 'neutral';
        }

        return `
          <tr>
            <td>${dateStr}</td>
            <td style="color: var(--text-muted); font-size: 0.75rem;">${t.id}</td>
            <td><span style="color: ${t.type === 'BUY' ? 'var(--color-success)' : 'var(--color-danger)'}; font-weight:700;">${t.type}</span></td>
            <td>${t.asset}</td>
            <td>${t.quantity.toFixed(4)}</td>
            <td>$${t.price.toFixed(2)}</td>
            <td>$${t.cost.toFixed(2)}</td>
            <td><span class="stat-change ${pnlClass}">${pnlText}</span></td>
          </tr>
        `;
      }).join('');
    }
  }

  // Appends a log line to console terminal
  addLog(entry: LogEntry) {
    const terminal = document.getElementById('terminal-log')!;
    const dateStr = new Date(entry.timestamp).toLocaleTimeString();
    const assetTag = entry.asset ? `<span style="color:var(--color-primary); font-weight:700;">[${entry.asset}]</span>` : '<span class="log-time">[System]</span>';

    const logDiv = document.createElement('div');
    logDiv.className = 'log-entry';
    logDiv.innerHTML = `
      <span class="log-time">[${dateStr}]</span> 
      ${assetTag}
      <span class="log-level ${entry.level}">${entry.level.toUpperCase()}</span> 
      <span class="log-msg">${entry.message}</span>
    `;

    terminal.appendChild(logDiv);
    // Scroll to bottom
    terminal.scrollTop = terminal.scrollHeight;
  }

  // Appends a log line specifically to Son of Alton console
  addAltonLog(entry: LogEntry) {
    const terminal = document.getElementById('alton-terminal-log');
    if (!terminal) return;
    
    // Clear initial idle message if this is the first actual log
    if (terminal.innerHTML.includes('Son of Alton idle.')) {
      terminal.innerHTML = '';
    }

    const dateStr = new Date(entry.timestamp).toLocaleTimeString();
    const assetTag = entry.asset ? `<span style="color:var(--color-primary); font-weight:700;">[${entry.asset}]</span>` : '';

    const logDiv = document.createElement('div');
    logDiv.className = 'log-entry';
    logDiv.innerHTML = `
      <span class="log-time">[${dateStr}]</span> 
      ${assetTag}
      <span class="log-level ai" style="color:var(--color-primary); font-weight:700;">AI</span> 
      <span class="log-msg">${entry.message.replace('[Son of Alton] ', '')}</span>
    `;

    terminal.appendChild(logDiv);
    terminal.scrollTop = terminal.scrollHeight;
  }

  // Render the list of compiled progress reports
  renderAltonReports(reports: any[]) {
    const viewer = document.getElementById('alton-report-viewer');
    if (!viewer || reports.length === 0) return;

    // Convert simple markdown headers/bullet points to HTML tags for nice rendering
    const latestReport = reports[0].reportMarkdown;
    let html = latestReport
      .replace(/### (.*)/g, '<h3 style="color:var(--color-primary); font-size:1.1rem; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:4px; margin-top:8px;">$1</h3>')
      .replace(/#### (.*)/g, '<h4 style="color:var(--text-main); font-size:0.9rem; margin-top:10px; margin-bottom:4px;">$1</h4>')
      .replace(/\* (.*)/g, '<li style="margin-left:14px; list-style-type:square; font-size:0.8rem;">$1</li>')
      .replace(/- (.*)/g, '<li style="margin-left:14px; font-size:0.8rem; color:var(--text-muted);">$1</li>')
      .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.05); padding:2px 4px; border-radius:4px; font-family:var(--font-mono); font-size:0.75rem;">$1</code>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-main); font-weight:700;">$1</strong>');

    // Replace linebreaks with paragraph breaks where appropriate
    html = html.split('\n').join('<br>');
    viewer.innerHTML = `<div style="display:flex; flex-direction:column; gap:4px;">${html}</div>`;
  }

  // Updates real-time news sentiment widget inside Son of Alton tab
  updateAltonSentiment(scores: [string, number][], headlines: [string, string[]][]) {
    const viewer = document.getElementById('alton-sentiment-viewer');
    if (!viewer || scores.length === 0) return;

    const headlinesMap = new Map(headlines);

    viewer.innerHTML = scores.map(([symbol, score]) => {
      const isBullish = score > 0.25;
      const isBearish = score < -0.25;
      const statusClass = isBullish ? 'positive' : isBearish ? 'negative' : 'neutral';
      const statusText = isBullish ? 'BULLISH (1.5x Alloc)' : isBearish ? 'BEARISH (Buy Halted)' : 'NEUTRAL';
      
      const symbolHeadlines = headlinesMap.get(symbol) || [];
      const latestHeadline = symbolHeadlines.length > 0 ? symbolHeadlines[0] : 'No recent articles found.';

      return `
        <div style="padding: 10px; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px solid var(--border-light); font-size: 0.8rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <strong style="color: var(--text-main); font-weight:700;">${symbol}</strong>
            <span class="stat-change ${statusClass}" style="font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px;">
              ${score > 0 ? '+' : ''}${score.toFixed(2)} | ${statusText}
            </span>
          </div>
          <div style="color: var(--text-muted); font-size: 0.75rem; line-height: 1.3; font-style: italic;">
            "${latestHeadline}"
          </div>
        </div>
      `;
    }).join('');
  }

  // Displays backtest output report inside the optimizer Recommendations tab
  showBacktestReport(report: BacktestReport) {
    const list = document.getElementById('perf-recommendations-list')!;
    
    const profitClass = report.netProfit >= 0 ? 'positive' : 'negative';
    const profitSign = report.netProfit >= 0 ? '+' : '';

    list.innerHTML = `
      <div class="rec-item success" style="border-left-color: var(--color-primary); background: rgba(56, 189, 248, 0.05);">
        <strong>Historical Backtest Completed successfully.</strong>
        <p style="margin-top: 8px; font-family: var(--font-mono); font-size: 0.85rem; line-height: 1.6;">
          Initial Capital: $${report.initialEquity.toFixed(2)}<br>
          Ending Portfolio Value: $${report.endingEquity.toFixed(2)}<br>
          Total Profit/Loss: <span class="stat-change ${profitClass}" style="display:inline;">${profitSign}$${report.netProfit.toFixed(2)} (${profitSign}${report.netProfitPct.toFixed(2)}%)</span><br>
          Executed Trades: ${report.totalTrades}<br>
          Win Rate: ${report.winRate.toFixed(1)}%<br>
          Max Drawdown: <span style="color: var(--color-danger); font-weight:700;">${report.maxDrawdownPct.toFixed(2)}%</span><br>
          Est. Sharpe Ratio: <span style="color: var(--color-primary); font-weight:700;">${report.sharpeRatio.toFixed(2)}</span>
        </p>
      </div>
      <div class="rec-item" style="margin-top: 10px;">
        <strong>Advisor Recommendation:</strong> Based on the backtest above, this strategy holds a ${report.winRate >= 50 ? 'favorable' : 'risky'} win expectancy of ${report.winRate.toFixed(1)}% over the tested timeframe. ${report.netProfit < 0 ? 'We suggest tuning your strategy parameters or testing another asset to avoid capital erosion.' : 'The parameters look profitable. You can proceed with paper-trading.'}
      </div>
    `;

    // Trigger update of metrics in performance panels
    document.getElementById('perf-factor')!.innerText = (report.winRate / (100 - report.winRate || 1)).toFixed(2);
    document.getElementById('perf-winrate')!.innerText = `${report.winRate.toFixed(1)}%`;
    document.getElementById('perf-avgwin')!.innerText = `$${(report.netProfit > 0 ? report.netProfit / (report.totalTrades / 2 || 1) : 0).toFixed(2)}`;
    document.getElementById('perf-avgloss')!.innerText = `$${(report.netProfit < 0 ? Math.abs(report.netProfit) / (report.totalTrades / 2 || 1) : 0).toFixed(2)}`;
  }

  // Opens advisor trade validation dialog
  showAdvisorModal(type: 'BUY' | 'SELL', asset: string, qty: number, price: number, onConfirm: () => void) {
    this.playChime(type === 'BUY' ? 'buy' : 'sell');

    const overlay = document.getElementById('advisor-modal-overlay')!;
    const sharesText = document.getElementById('advisor-modal-shares')!;
    const priceText = document.getElementById('advisor-modal-price')!;
    const promptText = document.getElementById('advisor-prompt-text')!;
    
    promptText.innerText = `Strategy calculations generated a ${type} signal for your portfolio:`;
    sharesText.innerText = `${qty.toFixed(4)} ${asset.split('/')[0]}`;
    priceText.innerText = `$${price.toFixed(2)}`;
    priceText.style.color = type === 'BUY' ? 'var(--color-success)' : 'var(--color-danger)';

    overlay.classList.add('active');

    // Button actions
    const btnCancel = document.getElementById('advisor-btn-cancel')!;
    const btnConfirm = document.getElementById('advisor-btn-confirm')!;

    const close = () => {
      overlay.classList.remove('active');
      // Clean listeners to avoid memory leaks
      btnCancel.replaceWith(btnCancel.cloneNode(true));
      btnConfirm.replaceWith(btnConfirm.cloneNode(true));
    };

    document.getElementById('advisor-btn-cancel')!.addEventListener('click', () => {
      close();
    });

    document.getElementById('advisor-btn-confirm')!.addEventListener('click', () => {
      onConfirm();
      close();
    });
  }

  // Local storage recovery helpers
  private getSavedBroker(): BrokerConfig {
    try {
      const data = localStorage.getItem('aegis_broker');
      if (data) return JSON.parse(data);
    } catch {}
    return { type: 'simulator', apiKey: '', apiSecret: '' };
  }

  private getSavedRisk(): RiskConfig {
    try {
      const data = localStorage.getItem('aegis_risk');
      if (data) {
        const parsed = JSON.parse(data);
        return {
          executionMode: parsed.executionMode || 'advisor',
          maxPositionSize: parsed.maxPositionSize || 1000,
          maxPositions: parsed.maxPositions || 3,
          dailyStopLossPct: parsed.dailyStopLossPct || 5,
          positionStopLossPct: parsed.positionStopLossPct || 2.0,
          positionTakeProfitPct: parsed.positionTakeProfitPct || 5.0
        };
      }
    } catch {}
    return { executionMode: 'advisor', maxPositionSize: 1000, maxPositions: 3, dailyStopLossPct: 5, positionStopLossPct: 2.0, positionTakeProfitPct: 5.0 };
  }

  private getSavedStrategy(): StrategyConfig {
    try {
      const data = localStorage.getItem('aegis_strategy');
      if (data) return JSON.parse(data);
    } catch {}
    return {
      type: 'sma_crossover',
      parameters: {
        smaFastPeriod: 10, smaSlowPeriod: 30,
        rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
        macdFastPeriod: 12, macdSlowPeriod: 26, macdSignalPeriod: 9
      }
    };
  }
}
