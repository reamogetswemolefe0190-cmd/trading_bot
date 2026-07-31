import { Trade, Position, BrokerConfig } from './Types';

export interface IBroker {
  init(): Promise<void>;
  getAccountBalance(): Promise<{ cash: number; equity: number }>;
  getPositions(): Promise<Position[]>;
  placeOrder(symbol: string, side: 'BUY' | 'SELL', qty: number, price: number): Promise<Trade>;
  liquidateAll(): Promise<void>;
  getNews(symbol: string): Promise<string[]>;
}

// Local simulation broker
export class LocalBroker implements IBroker {
  private cash: number = 100000;
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];

  constructor(initialCash: number = 100000) {
    this.cash = initialCash;
  }

  async init(): Promise<void> {}

  async getAccountBalance(): Promise<{ cash: number; equity: number }> {
    let totalPositionValue = 0;
    this.positions.forEach(pos => {
      totalPositionValue += pos.quantity * pos.currentPrice;
    });
    return {
      cash: this.cash,
      equity: this.cash + totalPositionValue
    };
  }

  async getPositions(): Promise<Position[]> {
    return Array.from(this.positions.values());
  }

  // Update current prices for simulator positions (calculates unrealized PnL)
  updateCurrentPrice(symbol: string, price: number) {
    const pos = this.positions.get(symbol);
    if (pos) {
      pos.currentPrice = price;
      pos.pnl = (pos.currentPrice - pos.averagePrice) * pos.quantity;
      pos.pnlPct = ((pos.currentPrice - pos.averagePrice) / pos.averagePrice) * 100;
    }
  }

  async placeOrder(symbol: string, side: 'BUY' | 'SELL', qty: number, price: number): Promise<Trade> {
    const commission = price * qty * 0.001; // Mock 0.1% commission/slippage
    const cost = price * qty;
    
    if (side === 'BUY') {
      const totalCost = cost + commission;
      if (this.cash < totalCost) {
        throw new Error(`Insufficient funds. Need $${totalCost.toFixed(2)}, have $${this.cash.toFixed(2)}`);
      }
      this.cash -= totalCost;

      const existing = this.positions.get(symbol);
      if (existing) {
        const newQty = existing.quantity + qty;
        const newAvg = (existing.averagePrice * existing.quantity + cost) / newQty;
        existing.quantity = newQty;
        existing.averagePrice = newAvg;
        existing.currentPrice = price;
        existing.pnl = (price - newAvg) * newQty;
        existing.pnlPct = ((price - newAvg) / newAvg) * 100;
      } else {
        this.positions.set(symbol, {
          asset: symbol,
          quantity: qty,
          averagePrice: price,
          currentPrice: price,
          pnl: 0,
          pnlPct: 0
        });
      }
    } else { // SELL
      const existing = this.positions.get(symbol);
      if (!existing || existing.quantity < qty) {
        throw new Error(`Insufficient shares to sell. Position has ${existing?.quantity || 0}, ordered ${qty}`);
      }

      const proceeds = cost - commission;
      this.cash += proceeds;

      const realizedPnl = (price - existing.averagePrice) * qty;

      if (existing.quantity === qty) {
        this.positions.delete(symbol);
      } else {
        existing.quantity -= qty;
        existing.pnl = (price - existing.averagePrice) * existing.quantity;
        existing.pnlPct = ((price - existing.averagePrice) / existing.averagePrice) * 100;
      }

      const trade: Trade = {
        id: Math.random().toString(36).substring(2, 11),
        type: 'SELL',
        asset: symbol,
        price,
        quantity: qty,
        cost,
        timestamp: Date.now(),
        pnl: realizedPnl
      };
      this.trades.push(trade);
      return trade;
    }

    const trade: Trade = {
      id: Math.random().toString(36).substring(2, 11),
      type: 'BUY',
      asset: symbol,
      price,
      quantity: qty,
      cost,
      timestamp: Date.now(),
      pnl: 0
    };
    this.trades.push(trade);
    return trade;
  }

  async liquidateAll(): Promise<void> {
    const list = Array.from(this.positions.values());
    for (const pos of list) {
      await this.placeOrder(pos.asset, 'SELL', pos.quantity, pos.currentPrice);
    }
  }

  async getNews(symbol: string): Promise<string[]> {
    if (symbol.includes('BTC') || symbol.includes('ETH')) {
      return [
        `Institutional buyers step in to push BTC prices higher`,
        `Regulatory warnings cause minor correction in crypto indexes`,
        `Bitcoin transaction activity surges as blockchain adopts fresh scaling scripts`,
        `Ethereum developer updates outline significant drop in gas costs`
      ];
    }
    if (symbol === 'AAPL') {
      return [
        `Apple announces major upgrades to Siri with new generative AI capabilities`,
        `Analysts upgrade Apple stock to buy ahead of anticipated phone launch`,
        `Supply chain report hints at massive production increase for next gen Apple devices`
      ];
    }
    if (symbol === 'TSLA') {
      return [
        `Tesla records surge in global EV sales as new gigafactory output increases`,
        `Concerns mount over autonomy software deadlines, analysts trim TSLA price targets`,
        `Tesla board approves stock buyback program, stock climbs 4%`
      ];
    }
    return [
      `${symbol} reports better than expected quarterly profits, stock surges`,
      `Concerns mount over product delays, analysts trim target price for ${symbol}`
    ];
  }
}

// Alpaca Live/Paper API broker implementation (uses Vite development proxies)
export class AlpacaBroker implements IBroker {
  private config: BrokerConfig;
  private baseUrl: string;

  constructor(config: BrokerConfig) {
    this.config = config;
    this.baseUrl = config.type === 'alpaca-live' ? '/api/alpaca-live' : '/api/alpaca-paper';
  }

  private getHeaders(): HeadersInit {
    return {
      'APCA-API-KEY-ID': this.config.apiKey,
      'APCA-API-SECRET-KEY': this.config.apiSecret,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  async init(): Promise<void> {
    // Validate credentials by fetching account details
    try {
      const res = await fetch(`${this.baseUrl}/v2/account`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Alpaca Auth Error: ${res.statusText} (${errText})`);
      }
    } catch (e: any) {
      throw new Error(`Failed to connect to Alpaca API: ${e.message}`);
    }
  }

  async getAccountBalance(): Promise<{ cash: number; equity: number }> {
    const res = await fetch(`${this.baseUrl}/v2/account`, {
      method: 'GET',
      headers: this.getHeaders()
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Alpaca Error: Failed to fetch account info - status ${res.status}: ${errText || res.statusText}`);
    }
    const data = await res.json();
    return {
      cash: parseFloat(data.cash),
      equity: parseFloat(data.portfolio_value)
    };
  }

  async getPositions(): Promise<Position[]> {
    const res = await fetch(`${this.baseUrl}/v2/positions`, {
      method: 'GET',
      headers: this.getHeaders()
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Alpaca Error: Failed to fetch positions - status ${res.status}: ${errText || res.statusText}`);
    }
    const data = await res.json();
    return data.map((pos: any) => {
      const qty = parseFloat(pos.qty);
      const avgPrice = parseFloat(pos.avg_entry_price);
      const curPrice = parseFloat(pos.current_price);
      const pnl = parseFloat(pos.unrealized_pl);
      const pnlPct = parseFloat(pos.unrealized_plpc) * 100;
      
      // Convert Alpaca asset names back to watchlist standard with slash
      let assetName = pos.symbol;
      if (assetName === 'BTCUSD') assetName = 'BTC/USD';
      if (assetName === 'ETHUSD') assetName = 'ETH/USD';

      return {
        asset: assetName,
        quantity: qty,
        averagePrice: avgPrice,
        currentPrice: curPrice,
        pnl,
        pnlPct
      };
    });
  }

  async placeOrder(symbol: string, side: 'BUY' | 'SELL', qty: number, price: number): Promise<Trade> {
    // Alpaca POST /v2/orders - remove slash from crypto assets for Alpaca API compatibility
    const normalizedSymbol = symbol.replace('/', '');
    const body = {
      symbol: normalizedSymbol,
      qty: qty.toString(),
      side: side.toLowerCase(),
      type: 'market',
      time_in_force: 'day'
    };

    const res = await fetch(`${this.baseUrl}/v2/orders`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Alpaca Order Failed: ${res.statusText} (${errText})`);
    }

    const order = await res.json();

    // Map order response to standard Trade type
    // Since it is a market order, the execution price will be close to the simulator's tick price
    const executionPrice = order.filled_avg_price ? parseFloat(order.filled_avg_price) : price;
    const cost = executionPrice * qty;

    return {
      id: order.id,
      type: side,
      asset: symbol,
      price: executionPrice,
      quantity: qty,
      cost,
      timestamp: new Date(order.created_at).getTime(),
      pnl: 0 // Will resolve when positions close/update
    };
  }

  async liquidateAll(): Promise<void> {
    // Alpaca close all positions: DELETE /v2/positions
    const res = await fetch(`${this.baseUrl}/v2/positions`, {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Alpaca Liquidation Failed: ${res.statusText} (${errText})`);
    }
  }

  async getNews(symbol: string): Promise<string[]> {
    try {
      // Remove slash for Alpaca data compatibility
      const normalizedSymbol = symbol.replace('/', '');
      const res = await fetch(`/api/alpaca-data/v1beta1/news?symbols=${normalizedSymbol}&limit=10`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      if (!res.ok) {
        throw new Error(`Alpaca News API status: ${res.status}`);
      }
      const data = await res.json();
      const articles = data.news || [];
      return articles.map((art: any) => art.headline);
    } catch (e: any) {
      console.warn(`[AlpacaBroker] Failed to fetch news for ${symbol}: ${e.message}`);
      return [];
    }
  }
}
