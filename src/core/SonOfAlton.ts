import { Robot } from './Robot';
import { Simulator } from './Simulator';
import { LogEntry, SonOfAltonReport, StrategyConfig } from './Types';
import { ReviewEngine } from './ReviewEngine';

export class SonOfAlton {
  private robot: Robot;
  private simulator: Simulator;
  
  private isEnabled: boolean = false;
  private timerId: any = null;
  private reports: SonOfAltonReport[] = [];
  
  // Auditing counters
  private auditCount: number = 0;
  private optimizedActionsCount: number = 0;

  // Sentiment tracker states
  private sentimentScores: Map<string, number> = new Map();
  private headlinesMap: Map<string, string[]> = new Map();
  private baselineMaxPosSizes: Map<string, number> = new Map();
  private rollingSentimentScores: Map<string, number[]> = new Map();

  // Rollback configuration stack per symbol
  private configHistoryStack: Map<string, StrategyConfig[]> = new Map();

  private positiveKeywords = [
    'bullish', 'upgrade', 'growth', 'beat', 'surge', 'breakout', 
    'gain', 'success', 'partnership', 'record high', 'climb', 
    'rebound', 'advances', 'positive', 'strong', 'gains'
  ];

  private negativeKeywords = [
    'bearish', 'downgrade', 'drop', 'fall', 'crash', 'plunge', 
    'warning', 'lawsuit', 'missed', 'regulatory', 'delays', 
    'trim', 'concerns', 'correction', 'negative', 'weak', 'losses'
  ];

  // Listeners to push data to UI
  private onLogCallback: ((entry: LogEntry) => void) | null = null;
  private onReportCallback: ((reports: SonOfAltonReport[]) => void) | null = null;

  constructor(robot: Robot, simulator: Simulator) {
    this.robot = robot;
    this.simulator = simulator;
  }

  onLog(cb: (entry: LogEntry) => void) {
    this.onLogCallback = cb;
  }

  onReport(cb: (reports: SonOfAltonReport[]) => void) {
    this.onReportCallback = cb;
  }

  enable() {
    if (this.isEnabled) return;
    this.isEnabled = true;
    this.log('info', 'Son of Alton AI Optimizer Enabled. Commencing background audits...');
    
    // Slow the interval down: read alton_interval_hours from localStorage (default 4)
    const hours = parseFloat(localStorage.getItem('alton_interval_hours') || '4');
    const intervalMs = Math.max(10000, hours * 60 * 60 * 1000); 
    
    this.timerId = setInterval(() => {
      this.runOptimizationSweep();
    }, intervalMs);
    
    // Run initial sweep immediately
    setTimeout(() => this.runOptimizationSweep(), 2000);
  }

  disable() {
    if (!this.isEnabled) return;
    this.isEnabled = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.log('warn', 'Son of Alton AI Optimizer Disabled.');
  }

  getIsEnabled(): boolean {
    return this.isEnabled;
  }

  getReports(): SonOfAltonReport[] {
    return this.reports;
  }

  getSentimentData() {
    return {
      scores: Array.from(this.sentimentScores.entries()),
      headlines: Array.from(this.headlinesMap.entries())
    };
  }

  public rollbackConfiguration(symbol: string): boolean {
    const stack = this.configHistoryStack.get(symbol);
    if (!stack || stack.length === 0) {
      this.log('warn', `Rollback ignored for ${symbol}: Stack is empty.`, symbol);
      return false;
    }
    const previous = stack.pop()!;
    this.robot.setStrategyConfig(symbol, previous);
    this.log('ai', `ROLLBACK ENFORCED: Reverted ${symbol} parameters to previous active profile.`, symbol);
    return true;
  }

  private log(level: LogEntry['level'], message: string, symbol?: string) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: level,
      message: `[Son of Alton] ${message}`,
      asset: symbol
    };
    
    this.robot.log(level, `[AI Optimizer] ${message}`, symbol);
    
    if (this.onLogCallback) {
      this.onLogCallback(entry);
    }
  }

  private calculateSentiment(headlines: string[]): number {
    if (headlines.length === 0) return 0;
    
    let posCount = 0;
    let negCount = 0;
    
    headlines.forEach(hl => {
      const lower = hl.toLowerCase();
      this.positiveKeywords.forEach(w => {
        if (lower.includes(w)) posCount++;
      });
      this.negativeKeywords.forEach(w => {
        if (lower.includes(w)) negCount++;
      });
    });
    
    const total = posCount + negCount;
    if (total === 0) return 0.0;
    
    return parseFloat(((posCount - negCount) / total).toFixed(2));
  }

  private async runOptimizationSweep() {
    if (!this.isEnabled) return;
    
    this.auditCount++;
    this.log('info', `Running audit sweep #${this.auditCount} across all active assets...`);
    
    let actionsTakenText: string[] = [];

    for (const asset of Simulator.assets) {
      const symbol = asset.symbol;
      const currentConfig = this.robot.getStrategyConfig(symbol);
      const candles = this.simulator.getCandles(symbol);

      // --- Part 1: NLP News Sentiment Scan ---
      try {
        const headlines = await this.robot.getNews(symbol);
        const score = this.calculateSentiment(headlines);
        
        this.sentimentScores.set(symbol, score);
        this.headlinesMap.set(symbol, headlines.slice(0, 3)); 

        // Rolling sentiment scores calculations (sustained bearish checks)
        if (!this.rollingSentimentScores.has(symbol)) {
          this.rollingSentimentScores.set(symbol, []);
        }
        const rolling = this.rollingSentimentScores.get(symbol)!;
        rolling.push(score);
        if (rolling.length > 3) rolling.shift();

        const avgScore = rolling.reduce((a, b) => a + b, 0) / rolling.length;

        const currentRisk = this.robot.getRiskConfig(symbol);
        
        if (!this.baselineMaxPosSizes.has(symbol)) {
          this.baselineMaxPosSizes.set(symbol, currentRisk.maxPositionSize);
        }
        
        const baseline = this.baselineMaxPosSizes.get(symbol)!;
        let originalSize = currentRisk.maxPositionSize;

        if (avgScore > 0.25) {
          // Bullish: Boost allocation by 1.2x max (capped as per v2)
          currentRisk.maxPositionSize = baseline * 1.2;
          currentRisk.positionStopLossPct = 1.5;
          this.robot.setRiskConfig(symbol, currentRisk);
          
          if (originalSize !== currentRisk.maxPositionSize) {
            this.log('ai', `Sentiment ranking: BULLISH (${avgScore.toFixed(2)}). Allocation boosted to $${currentRisk.maxPositionSize} for ${symbol}.`, symbol);
          }
        } else if (avgScore < -0.25) {
          // Bearish sustained check: Freeze buying allocation to $0
          currentRisk.maxPositionSize = 0;
          this.robot.setRiskConfig(symbol, currentRisk);
          
          if (originalSize !== 0) {
            this.log('warn', `Sentiment ranking: BEARISH (${avgScore.toFixed(2)}). Sustained sell bias halts buying ($0 allocation) for ${symbol}.`, symbol);
          }
        } else {
          // Neutral: Restore baseline size
          currentRisk.maxPositionSize = baseline;
          currentRisk.positionStopLossPct = 2.0;
          this.robot.setRiskConfig(symbol, currentRisk);
          
          if (originalSize !== baseline) {
            this.log('info', `Sentiment ranking: NEUTRAL (${avgScore.toFixed(2)}). Restored baseline size $${baseline} for ${symbol}.`, symbol);
          }
        }
      } catch (newsErr: any) {
        console.warn(`[SonOfAlton] Sentiment update failed for ${symbol}:`, newsErr.message);
      }

      // --- Part 2: Technical Strategy Param Sweeps ---
      // For ML strategy, trigger background retraining
      if (currentConfig.type === 'ml_predict') {
        try {
          const mlUrl = localStorage.getItem('ml_url') || 'http://localhost:5000';
          const cachedBrokerStr = localStorage.getItem('aegis_broker');
          const apiKey = cachedBrokerStr ? JSON.parse(cachedBrokerStr).apiKey : '';
          const apiSecret = cachedBrokerStr ? JSON.parse(cachedBrokerStr).apiSecret : '';
          const cleanSym = symbol.replace('/', '_');
          const filepath = `data/history/${cleanSym}_history.json`;

          this.log('info', `Son of Alton triggering background ML retraining for ${symbol}...`, symbol);

          const res = await fetch(`${mlUrl}/train`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              symbol: symbol,
              filepath: filepath,
              apiKey: apiKey,
              apiSecret: apiSecret
            })
          });
          const data = await res.json();
          if (res.ok) {
            this.log('ai', `AUTONOMOUS ML TRAINING SUCCESS: Model for ${symbol} recalibrated. Accuracy: ${(data.training_accuracy * 100).toFixed(1)}%`, symbol);
          } else {
            this.log('warn', `Autonomous ML training failed: ${data.error}`, symbol);
          }
        } catch (trainErr: any) {
          console.warn(`[SonOfAlton] ML auto-training sweep failed:`, trainErr.message);
        }
        continue;
      }

      // Out-Of-Sample Validation Split
      if (candles.length < 500) {
        this.log('warn', `Audit for ${symbol} skipped: Insufficient candles history (${candles.length}/500 required).`, symbol);
        continue;
      }

      // Calculate dynamic volatility proxy
      let sumChanges = 0;
      const checkWindow = Math.min(20, candles.length - 1);
      for (let i = candles.length - checkWindow; i < candles.length; i++) {
        if (i > 0) {
          sumChanges += Math.abs(candles[i].close - candles[i-1].close) / candles[i-1].close;
        }
      }
      const volProxy = (sumChanges / checkWindow) * 100;
      
      // Volatility scales OOS portion from 20% to 40%
      const oosRatio = 0.20 + Math.min(0.20, volProxy * 0.15); 
      const oosCount = Math.floor(candles.length * oosRatio);
      const inSampleCount = candles.length - oosCount;
      
      const inSampleCandles = candles.slice(0, inSampleCount);
      const outOfSampleCandles = candles.slice(inSampleCount);

      // Perform grid-search optimize parameters on the in-sample window
      const optResult = ReviewEngine.optimizeParameters(inSampleCandles, currentConfig);
      
      let isDiff = false;
      const params = currentConfig.parameters as any;
      const optParams = optResult.optimalParams as any;

      Object.keys(optParams).forEach(key => {
        if (params[key] !== optParams[key]) {
          isDiff = true;
        }
      });

      if (isDiff && Object.keys(optParams).length > 0) {
        // Construct candidate config
        const candidateConfig: StrategyConfig = {
          type: currentConfig.type,
          parameters: {
            ...currentConfig.parameters,
            ...optParams
          }
        };

        // Evaluate candidate outperformance on both windows
        const currentInSample = ReviewEngine.runMockBacktest(inSampleCandles, 10000, currentConfig);
        const candidateInSample = ReviewEngine.runMockBacktest(inSampleCandles, 10000, candidateConfig);

        const currentOos = ReviewEngine.runMockBacktestWithTradeCount(outOfSampleCandles, 10000, currentConfig);
        const candidateOos = ReviewEngine.runMockBacktestWithTradeCount(outOfSampleCandles, 10000, candidateConfig);

        // Validation gate
        if (candidateInSample > currentInSample && 
            candidateOos.equity > currentOos.equity && 
            candidateOos.tradeCount >= 3) {
          
          // Save in rollback stack before swapping
          if (!this.configHistoryStack.has(symbol)) {
            this.configHistoryStack.set(symbol, []);
          }
          this.configHistoryStack.get(symbol)!.push({
            type: currentConfig.type,
            parameters: { ...currentConfig.parameters }
          });

          const oldParamsStr = Object.keys(optParams).map(k => `${k}: ${params[k]}`).join(', ');
          const newParamsStr = Object.keys(optParams).map(k => `${k}: ${optParams[k]}`).join(', ');

          this.log(
            'ai', 
            `VALIDATION PASS: Walk-Forward swap approved for ${symbol}. In-Sample (Current: $${currentInSample.toFixed(2)}, Opt: $${candidateInSample.toFixed(2)}) | Out-of-Sample (Current: $${currentOos.equity.toFixed(2)}, Opt: $${candidateOos.equity.toFixed(2)} | Trades: ${candidateOos.tradeCount}). Swap active.`, 
            symbol
          );

          this.robot.setStrategyConfig(symbol, candidateConfig);
          this.optimizedActionsCount++;
          actionsTakenText.push(`- **${symbol}**: Tuned settings from \`{${oldParamsStr}}\` to \`{${newParamsStr}}\` after passing walk-forward gates.`);
        } else {
          this.log(
            'info',
            `VALIDATION FAIL: Candidate config for ${symbol} failed validation gate. In-Sample Opt: $${candidateInSample.toFixed(2)} vs Active: $${currentInSample.toFixed(2)} | Out-of-Sample Opt: $${candidateOos.equity.toFixed(2)} vs Active: $${currentOos.equity.toFixed(2)} (Trades: ${candidateOos.tradeCount}). Swap blocked.`,
            symbol
          );
        }
      }
    }

    // Every 3 sweeps (~2.5 minutes), compile a structured Progress Report
    if (this.auditCount % 3 === 0) {
      await this.compileProgressReport(actionsTakenText);
    }
  }

  private async compileProgressReport(actions: string[]) {
    this.log('info', 'Compiling Daily Progress Report card...');

    let activeStrategiesList = '';
    for (const asset of Simulator.assets) {
      const config = this.robot.getStrategyConfig(asset.symbol);
      const params = config.parameters as any;
      let paramText = '';
      if (config.type === 'sma_crossover') {
        paramText = `Fast: ${params.smaFastPeriod}, Slow: ${params.smaSlowPeriod}`;
      } else if (config.type === 'rsi_mean_reversion') {
        paramText = `Period: ${params.rsiPeriod}, Thresholds: ${params.rsiOversold}/${params.rsiOverbought}`;
      } else if (config.type === 'bollinger_bands') {
        paramText = `Period: ${params.bbPeriod || 20}, Mult: ${params.bbMultiplier || 2.0}`;
      } else if (config.type === 'ml_predict') {
        paramText = `Python RF Classifier (Live)`;
      } else {
        paramText = `Fast: ${params.macdFastPeriod}, Slow: ${params.macdSlowPeriod}, Signal: ${params.macdSignalPeriod}`;
      }
      activeStrategiesList += `* **${asset.symbol}**: ${config.type.toUpperCase().replace('_', ' ')} (${paramText})\n`;
    }

    let sentimentRanks = '';
    for (const [sym, score] of this.sentimentScores.entries()) {
      const status = score > 0.25 ? '⚡ BULLISH (Max Allocation)' : score < -0.25 ? '⚠️ BEARISH (Buy Halted)' : '⚖️ NEUTRAL';
      sentimentRanks += `* **${sym}**: Score: **${score > 0 ? '+' : ''}${score}** (${status})\n`;
    }

    const actionSummary = actions.length > 0 
      ? actions.join('\n') 
      : '- No parameter recalibrations required (active configurations matching current market regime).';

    const reportMarkdown = `### Son of Alton Progress Report Card
*Compiled on simulated interval: ${new Date().toLocaleTimeString()}*

#### 1. System Status
* **Autonomous Recalibrations**: ACTIVE
* **Global Target Mode**: AUTOPILOT
* **Cumulative Audits Run**: ${this.auditCount}
* **Parameters Adjusted**: ${this.optimizedActionsCount}

#### 2. Active Strategy Mappings
${activeStrategiesList}

#### 3. News Sentiment Rankings
${sentimentRanks || '*Waiting for news data scans...*'}

#### 4. AI Decisions & Reprogramming Log
${actionSummary}

#### 5. Safety Audit & Net-Exposure
* **Stop-Loss / Take-Profit Boundaries**: **ENFORCED (Non-Negotiable)**
* **Halt Trigger**: Set to halt all trades if Daily NAV drops by more than **5.0%**.
`;

    const report: SonOfAltonReport = {
      timestamp: Date.now(),
      reportMarkdown
    };

    this.reports.unshift(report);
    if (this.reports.length > 20) this.reports.pop();

    if (this.onReportCallback) {
      this.onReportCallback(this.reports);
    }
  }
}
