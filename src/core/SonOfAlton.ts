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
    
    // Run optimization sweep every 45 seconds (speedy simulated intervals)
    this.timerId = setInterval(() => {
      this.runOptimizationSweep();
    }, 45000);
    
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

  private log(level: LogEntry['level'], message: string, symbol?: string) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: level,
      message: `[Son of Alton] ${message}`,
      asset: symbol
    };
    
    // Relay log to robot so it appears in aggregate console logs
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

  // Audits active bot parameters and updates configurations if a more profitable profile is resolved
  private async runOptimizationSweep() {
    if (!this.isEnabled) return;
    
    this.auditCount++;
    this.log('info', `Running audit sweep #${this.auditCount} across all active assets...`);
    
    let actionsTakenText: string[] = [];

    for (const asset of Simulator.assets) {
      const symbol = asset.symbol;
      const currentConfig = this.robot.getStrategyConfig(symbol);
      const candles = this.simulator.getCandles(symbol);

      // --- Part 1: News Sentiment Fetching & Capital Allocation ---
      try {
        const headlines = await this.robot.getNews(symbol);
        const score = this.calculateSentiment(headlines);
        
        this.sentimentScores.set(symbol, score);
        this.headlinesMap.set(symbol, headlines.slice(0, 3)); // Store top 3 headlines

        const currentRisk = this.robot.getRiskConfig(symbol);
        
        // Record baseline size if not tracked yet
        if (!this.baselineMaxPosSizes.has(symbol)) {
          this.baselineMaxPosSizes.set(symbol, currentRisk.maxPositionSize);
        }
        
        const baseline = this.baselineMaxPosSizes.get(symbol)!;
        let originalSize = currentRisk.maxPositionSize;

        if (score > 0.25) {
          // Bullish: Boost allocation by 1.5x, tighten Stop Loss to 1.5%
          currentRisk.maxPositionSize = baseline * 1.5;
          currentRisk.positionStopLossPct = 1.5;
          this.robot.setRiskConfig(symbol, currentRisk);
          
          if (originalSize !== currentRisk.maxPositionSize) {
            this.log('ai', `Sentiment ranking: BULLISH (${score > 0 ? '+' : ''}${score}). Allocation boosted to $${currentRisk.maxPositionSize} for ${symbol}.`, symbol);
          }
        } else if (score < -0.25) {
          // Bearish: Freeze buying allocation to $0 (protecting capital)
          currentRisk.maxPositionSize = 0;
          this.robot.setRiskConfig(symbol, currentRisk);
          
          if (originalSize !== 0) {
            this.log('warn', `Sentiment ranking: BEARISH (${score}). BUY orders frozen ($0 allocation) for ${symbol} to protect capital.`, symbol);
          }
        } else {
          // Neutral: Restore baseline size, default Stop Loss back to 2.0%
          currentRisk.maxPositionSize = baseline;
          currentRisk.positionStopLossPct = 2.0;
          this.robot.setRiskConfig(symbol, currentRisk);
          
          if (originalSize !== baseline) {
            this.log('info', `Sentiment ranking: NEUTRAL (${score > 0 ? '+' : ''}${score}). Restored baseline size $${baseline} for ${symbol}.`, symbol);
          }
        }
      } catch (newsErr: any) {
        console.warn(`[SonOfAlton] Sentiment update failed for ${symbol}:`, newsErr.message);
      }

      // --- Part 2: Technical Strategy Param Sweeps ---
      if (candles.length < 30) {
        this.log('warn', `Audit for ${symbol} skipped: Insufficient candles history (${candles.length}/30).`, symbol);
        continue;
      }

      // For ML strategy, trigger background retraining on every AI sweep to keep the model updated with the latest market data
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

      const optResult = ReviewEngine.optimizeParameters(candles, currentConfig);
      
      // Determine if parameters need updates
      let isDiff = false;
      const params = currentConfig.parameters as any;
      const optParams = optResult.optimalParams as any;

      Object.keys(optParams).forEach(key => {
        if (params[key] !== optParams[key]) {
          isDiff = true;
        }
      });

      if (isDiff && Object.keys(optParams).length > 0) {
        // Construct updated configuration profile
        const updatedConfig: StrategyConfig = {
          type: currentConfig.type,
          parameters: {
            ...currentConfig.parameters,
            ...optParams
          }
        };

        const oldParamsStr = Object.keys(optParams).map(k => `${k}: ${params[k]}`).join(', ');
        const newParamsStr = Object.keys(optParams).map(k => `${k}: ${optParams[k]}`).join(', ');

        this.log(
          'ai', 
          `AUTO-RECALIBRATION: Parameter drift corrected in ${symbol}. Reprogrammed settings from {${oldParamsStr}} to {${newParamsStr}}.`, 
          symbol
        );

        this.robot.setStrategyConfig(symbol, updatedConfig);
        this.optimizedActionsCount++;
        actionsTakenText.push(`- **${symbol}**: Tuned settings from \`{${oldParamsStr}}\` to \`{${newParamsStr}}\` based on historical price sweep.`);
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
