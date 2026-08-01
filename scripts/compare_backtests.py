#!/usr/bin/env python3
import os
import json
import random
import math

# Try importing numpy, pandas, and matplotlib; fallback cleanly if missing
try:
    import numpy as np
    import pandas as pd
    import matplotlib.pyplot as plt
    HAS_PLOT_LIBS = True
except ImportError:
    HAS_PLOT_LIBS = False

# Self-contained indicator calculation
def get_sma(prices, period):
    if len(prices) < period:
        return 0.0
    return sum(prices[-period:]) / period

def get_signal(prices, fast_period, slow_period):
    if len(prices) < slow_period + 1:
        return 'HOLD'
    
    cur_fast = get_sma(prices, fast_period)
    cur_slow = get_sma(prices, slow_period)
    
    prev_prices = prices[:-1]
    prev_fast = get_sma(prev_prices, fast_period)
    prev_slow = get_sma(prev_prices, slow_period)
    
    if prev_fast <= prev_slow and cur_fast > cur_slow:
        return 'BUY'
    elif prev_fast >= prev_slow and cur_fast < cur_slow:
        return 'SELL'
    return 'HOLD'

# Fast backtest simulation returning final equity and trade count
def run_mock_backtest(close_prices, fast, slow):
    cash = 10000.0
    holdings = 0.0
    trade_count = 0
    
    for i in range(15, len(close_prices)):
        slice_prices = close_prices[:i+1]
        signal = get_signal(slice_prices, fast, slow)
        price = close_prices[i]
        
        if signal == 'BUY' and holdings == 0.0:
            commission = cash * 0.001
            holdings = (cash - commission) / price
            cash = 0.0
            trade_count += 1
        elif signal == 'SELL' and holdings > 0.0:
            value = holdings * price
            commission = value * 0.001
            cash = value - commission
            holdings = 0.0
            trade_count += 1
            
    final_price = close_prices[-1]
    return cash + holdings * final_price, trade_count

# Parameter grid search optimization
def optimize_parameters(close_prices):
    fast_options = [5, 10, 15, 20]
    slow_options = [20, 30, 45, 60]
    best_equity = 0.0
    best_params = {'fast': 10, 'slow': 30}
    
    for fast in fast_options:
        for slow in slow_options:
            if fast >= slow:
                continue
            eq, _ = run_mock_backtest(close_prices, fast, slow)
            if eq > best_equity:
                best_equity = eq
                best_params = {'fast': fast, 'slow': slow}
                
    return best_params

def main():
    print("==================================================================")
    print("   AEGIS TRADER - PYTHON QUANT ALTON V1 VS V2 BACKTEST HARNESS   ")
    print("==================================================================")
    
    # Load historical candles
    history_file = os.path.join(os.path.dirname(__file__), '../data/history/BTC_USD_history.json')
    close_prices = []
    
    if os.path.exists(history_file):
        try:
            with open(history_file, 'r') as f:
                candles = json.load(f)
            close_prices = [float(c['close']) for c in candles]
            print(f"[Data] Loaded {len(close_prices)} historical close prices from BTC_USD_history.json.")
        except Exception as e:
            print(f"[Data] Could not parse history file: {str(e)}")
            
    if len(close_prices) < 200:
        print("[Data] Generating synthetic trend history (500 daily candles)...")
        price = 50000.0
        random.seed(42)  # Fixed seed for reproducibility
        for _ in range(500):
            change = price * (0.0003 + 0.018 * (random.random() - 0.49))
            price += change
            close_prices.append(price)

    # ---------------------------------------------------------
    # SIMULATION V1: 45-Second Cadence (Immediate Swap on In-Sample)
    # ---------------------------------------------------------
    v1_cash = 10000.0
    v1_holdings = 0.0
    v1_swaps = 0
    v1_fast = 10
    v1_slow = 30
    v1_trades = 0
    v1_wins = 0
    v1_entry = 0.0
    v1_history = []
    
    for i in range(120, len(close_prices)):
        recent_60 = close_prices[i-60:i]
        price = close_prices[i]
        
        # V1 runs optimization audits on every step
        opt = optimize_parameters(recent_60)
        if opt['fast'] != v1_fast or opt['slow'] != v1_slow:
            v1_fast = opt['fast']
            v1_slow = opt['slow']
            v1_swaps += 1
            
        signal = get_signal(close_prices[:i+1], v1_fast, v1_slow)
        if signal == 'BUY' and v1_holdings == 0.0:
            commission = v1_cash * 0.001
            v1_holdings = (v1_cash - commission) / price
            v1_cash = 0.0
            v1_entry = price
        elif signal == 'SELL' and v1_holdings > 0.0:
            value = v1_holdings * price
            commission = value * 0.001
            v1_cash = value - commission
            v1_holdings = 0.0
            v1_trades += 1
            if price > v1_entry:
                v1_wins += 1
                
        v1_history.append(v1_cash + v1_holdings * price)

    v1_final_equity = v1_cash + v1_holdings * close_prices[-1]

    # ---------------------------------------------------------
    # SIMULATION V2: Validation Gated (hourly splits, out-of-sample checks)
    # ---------------------------------------------------------
    v2_cash = 10000.0
    v2_holdings = 0.0
    v2_swaps = 0
    v2_fast = 10
    v2_slow = 30
    v2_trades = 0
    v2_wins = 0
    v2_entry = 0.0
    v2_history = []
    
    for i in range(120, len(close_prices)):
        price = close_prices[i]
        
        # V2 checks optimizer only on interval (simulated 4-period check)
        if i % 4 == 0:
            recent_window = close_prices[i-60:i]
            
            # Dynamic volatility out-of-sample window sizing
            sum_changes = 0.0
            for j in range(len(recent_window) - 10, len(recent_window)):
                if j > 0:
                    sum_changes += abs(recent_window[j] - recent_window[j-1]) / recent_window[j-1]
            vol = (sum_changes / 10.0) * 100.0
            oos_ratio = 0.20 + min(0.20, vol * 0.15)
            oos_count = int(len(recent_window) * oos_ratio)
            in_sample_count = len(recent_window) - oos_count
            
            in_sample = recent_window[:in_sample_count]
            out_of_sample = recent_window[in_sample_count:]
            
            candidate = optimize_parameters(in_sample)
            
            if candidate['fast'] != v2_fast or candidate['slow'] != v2_slow:
                # Run mock backtests to validate candidate against active parameters
                cur_in_sample, _ = run_mock_backtest(in_sample, v2_fast, v2_slow)
                cand_in_sample, _ = run_mock_backtest(in_sample, candidate['fast'], candidate['slow'])
                
                cur_oos, _ = run_mock_backtest(out_of_sample, v2_fast, v2_slow)
                cand_oos, cand_oos_trades = run_mock_backtest(out_of_sample, candidate['fast'], candidate['slow'])
                
                # Out-of-sample Validation Gate checks
                if cand_in_sample > cur_in_sample and cand_oos > cur_oos and cand_oos_trades >= 2:
                    v2_fast = candidate['fast']
                    v2_slow = candidate['slow']
                    v2_swaps += 1

        signal = get_signal(close_prices[:i+1], v2_fast, v2_slow)
        if signal == 'BUY' and v2_holdings == 0.0:
            commission = v2_cash * 0.001
            v2_holdings = (v2_cash - commission) / price
            v2_cash = 0.0
            v2_entry = price
        elif signal == 'SELL' and v2_holdings > 0.0:
            value = v2_holdings * price
            commission = value * 0.001
            v2_cash = value - commission
            v2_holdings = 0.0
            v2_trades += 1
            if price > v2_entry:
                v2_wins += 1
                
        v2_history.append(v2_cash + v2_holdings * price)

    v2_final_equity = v2_cash + v2_holdings * close_prices[-1]

    # Metrics compiling
    v1_return = ((v1_final_equity - 10000.0) / 10000.0) * 100.0
    v2_return = ((v2_final_equity - 10000.0) / 10000.0) * 100.0
    v1_winrate = (v1_wins / v1_trades * 100.0) if v1_trades > 0 else 0.0
    v2_winrate = (v2_wins / v2_trades * 100.0) if v2_trades > 0 else 0.0

    print("\n+------------------------------+--------------------+--------------------+")
    print("| Performance Metric           | V1 (45s In-Sample) | V2 (Gated Walk-F)  |")
    print("+------------------------------+--------------------+--------------------+")
    print(f"| Initial Capital              | $10,000.00         | $10,000.00         |")
    print(f"| Final Portfolio Value        | ${v1_final_equity:,.2f}          | ${v2_final_equity:,.2f}          |")
    print(f"| Net Return (%)               | {v1_return:+.2f}%             | {v2_return:+.2f}%             |")
    print(f"| Total Executed Trades        | {v1_trades:<18} | {v2_trades:<18} |")
    print(f"| Strategy Win Rate (%)        | {v1_winrate:.1f}%              | {v2_winrate:.1f}%              |")
    print(f"| Parameter Swaps Triggered    | {v1_swaps:<18} | {v2_swaps:<18} |")
    print("+------------------------------+--------------------+--------------------+")

    # Generate Matplotlib chart if libraries exist
    if HAS_PLOT_LIBS:
        print("[Chart] Building high-fidelity plot...")
        plt.style.use('dark_background')
        
        fig, ax = plt.subplots(figsize=(10, 5), dpi=300)
        fig.patch.set_facecolor('#0B0F19')
        ax.set_facecolor('#111827')
        
        # Grid settings
        ax.grid(color='#ffffff', alpha=0.06, linestyle='-', linewidth=0.5)
        
        # Plot curves
        steps = list(range(len(v1_history)))
        ax.plot(steps, v1_history, label='V1 (45s In-Sample)', color='#06B6D4', alpha=0.6, linewidth=1.5)
        ax.plot(steps, v2_history, label='V2 (Gated Walk-F)', color='#10B981', linewidth=2.5)
        
        # Titles & Labels
        ax.set_title('Aegis Trader - Equity Curve Performance (Python Engine)', fontsize=13, fontweight='bold', pad=15, color='#FFFFFF')
        ax.set_xlabel('Simulation Steps (Candle Closes)', fontsize=10, color='#9CA3AF', labelpad=10)
        ax.set_ylabel('Portfolio Equity ($)', fontsize=10, color='#9CA3AF', labelpad=10)
        
        # Custom ticks formatting
        ax.tick_params(colors='#9CA3AF', labelsize=9)
        ax.get_yaxis().set_major_formatter(plt.FuncFormatter(lambda x, loc: "{:,}".format(int(x))))
        
        # Legend styling
        legend = ax.legend(facecolor='#111827', edgecolor='#1F2937', loc='upper left', prop={'size': 9})
        for text in legend.get_texts():
            text.set_color('#D1D5DB')
            
        plt.tight_layout()
        
        # Output directory: brain folder or current dir fallback
        output_dir = 'C:\\Users\\User\\.gemini\\antigravity\\brain\\565251f7-2734-4b44-8af7-823d96cb4b60'
        if not os.path.exists(output_dir):
            output_dir = os.path.dirname(__file__)
            
        chart_path = os.path.join(output_dir, 'equity_curves_python.png')
        plt.savefig(chart_path, facecolor=fig.get_facecolor(), edgecolor='none')
        print(f"[Chart] Saved premium equity curves chart to: {chart_path}")
    else:
        print("[Chart] Matplotlib or pandas not installed. Skipped saving PNG chart.")

if __name__ == '__main__':
    main()
