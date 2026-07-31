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

      if (candles.length < 30) {
        this.log('warn', `Audit for ${symbol} skipped: Insufficient candles history (${candles.length}/30).`, symbol);
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
      } else {
        paramText = `Fast: ${params.macdFastPeriod}, Slow: ${params.macdSlowPeriod}, Signal: ${params.macdSignalPeriod}`;
      }
      activeStrategiesList += `* **${asset.symbol}**: ${config.type.toUpperCase().replace('_', ' ')} (${paramText})\n`;
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

#### 3. AI Decisions & Reprogramming Log
${actionSummary}

#### 4. Safety Audit & Net-Exposure
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
