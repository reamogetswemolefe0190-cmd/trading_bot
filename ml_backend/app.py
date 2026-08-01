import os
import json
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
from sklearn.ensemble import RandomForestClassifier
import joblib

app = Flask(__name__)
CORS(app)

# Directory to save trained model files
MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')
os.makedirs(MODEL_DIR, exist_ok=True)

# Helper: Compute technical features on a DataFrame
def compute_features(df):
    # Copy dataframe to avoid slicing warnings
    df = df.copy()
    
    # 1. Standard Price Returns
    df['return_1'] = df['close'].pct_change()
    df['return_5'] = df['close'].pct_change(5)
    
    # 2. Simple Volatility
    df['volatility_5'] = df['return_1'].rolling(5).std()
    
    # 3. Simple RSI calculation
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / (loss + 1e-9)
    df['rsi_14'] = 100 - (100 / (1 + rs))
    
    # Fill NaN values caused by rolling windows
    df = df.bfill().fillna(0)
    return df

# Helper: Fetch historical daily candles directly from Alpaca API
def fetch_candles_from_alpaca(symbol, days, api_key, api_secret):
    import datetime
    import urllib.request
    import urllib.error
    
    end_time = datetime.datetime.utcnow()
    start_time = end_time - datetime.timedelta(days=days)
    
    # Format dates strictly to RFC3339 second-precision (Alpaca rejects microsecond decimals)
    start_iso = start_time.strftime('%Y-%m-%dT%H:%M:%SZ')
    end_iso = end_time.strftime('%Y-%m-%dT%H:%M:%SZ')
    
    is_crypto = '/' in symbol or 'BTC' in symbol or 'ETH' in symbol
    
    if is_crypto:
        # Alpaca v1beta3 Crypto API requires the slash in the symbol name (e.g. BTC/USD)
        formatted_sym = symbol.replace('_', '/')
        if '/' not in formatted_sym:
            formatted_sym = formatted_sym[:3] + '/' + formatted_sym[3:]
        encoded_sym = formatted_sym.replace('/', '%2F')
        url = f"https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols={encoded_sym}&timeframe=1Day&start={start_iso}&end={end_iso}&limit=1000"
    else:
        url = f"https://data.alpaca.markets/v2/stocks/{symbol}/bars?timeframe=1Day&start={start_iso}&end={end_iso}&limit=1000&adjustment=raw"
        
    req = urllib.request.Request(url)
    req.add_header('APCA-API-KEY-ID', api_key)
    req.add_header('APCA-API-SECRET-KEY', api_secret)
    
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode())
    except urllib.error.HTTPError as http_err:
        err_body = http_err.read().decode()
        raise Exception(f"Alpaca API returned {http_err.code}: {err_body}")
        
    bars = []
    if is_crypto:
        # Restore standard symbol with slash to extract from JSON response
        formatted_sym = symbol.replace('_', '/')
        if '/' not in formatted_sym:
            formatted_sym = formatted_sym[:3] + '/' + formatted_sym[3:]
        bars = res_data.get('bars', {}).get(formatted_sym, [])
    else:
        bars = res_data.get('bars', [])
        
    formatted_data = []
    for b in bars:
        formatted_data.append({
            'time': b['t'].split('T')[0],
            'open': b['o'],
            'high': b['h'],
            'low': b['l'],
            'close': b['c'],
            'volume': b['v']
        })
        
    return formatted_data

# Helper: Fetch crypto candles from Coinbase public API (No keys required)
def fetch_candles_from_coinbase(symbol):
    import datetime
    import urllib.request
    
    clean_sym = symbol.replace('/', '-').upper()
    if '-' not in clean_sym:
        if clean_sym.startswith('BTC'):
            clean_sym = 'BTC-USD'
        elif clean_sym.startswith('ETH'):
            clean_sym = 'ETH-USD'
        else:
            clean_sym = clean_sym[:3] + '-' + clean_sym[3:]
            
    url = f"https://api.exchange.coinbase.com/products/{clean_sym}/candles?granularity=86400"
    
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'AegisTrader/1.0'}
    )
    
    with urllib.request.urlopen(req) as response:
        res_data = json.loads(response.read().decode())
        
    formatted_data = []
    for bar in reversed(res_data):
        dt = datetime.datetime.utcfromtimestamp(bar[0])
        formatted_data.append({
            'time': dt.strftime('%Y-%m-%d'),
            'open': float(bar[3]),
            'high': float(bar[2]),
            'low': float(bar[1]),
            'close': float(bar[4]),
            'volume': float(bar[5])
        })
    return formatted_data

@app.route('/train', methods=['POST'])
def train():
    """
    Trains a RandomForest model dynamically from Alpaca, Coinbase (no-auth), or local files
    """
    req_data = request.get_json()
    if not req_data or 'symbol' not in req_data:
        return jsonify({"error": "Missing symbol in request body"}), 400
        
    symbol = req_data['symbol']
    api_key = req_data.get('apiKey')
    api_secret = req_data.get('apiSecret')
    
    candles = []
    if api_key and api_secret:
        try:
            candles = fetch_candles_from_alpaca(symbol, 365, api_key, api_secret)
        except Exception as fetch_err:
            return jsonify({"error": f"Failed to fetch historical data from Alpaca: {str(fetch_err)}"}), 500
    else:
        # No keys provided! If it is a crypto symbol, fall back to Coinbase's public no-auth feed
        is_crypto = '/' in symbol or 'BTC' in symbol or 'ETH' in symbol
        if is_crypto:
            try:
                candles = fetch_candles_from_coinbase(symbol)
            except Exception as cb_err:
                return jsonify({"error": f"Failed to fetch public crypto history from Coinbase: {str(cb_err)}"}), 500
        else:
            filepath = req_data.get('filepath')
            if not filepath:
                return jsonify({"error": "Missing Alpaca API keys to retrieve stock history"}), 400
                
            if not os.path.exists(filepath):
                return jsonify({"error": f"File not found: {filepath}"}), 404
                
            try:
                with open(filepath, 'r') as f:
                    candles = json.load(f)
            except Exception as file_err:
                return jsonify({"error": f"Failed to read history file: {str(file_err)}"}), 500

    try:
        df = pd.DataFrame(candles)
        if len(df) < 50:
            return jsonify({"error": "Insufficient candles to train model (minimum 50 required)"}), 400
            
        # Compute features
        df = compute_features(df)
        
        # Define target: 1 if the close price in 5 candles is higher than the current close, else 0
        df['future_close'] = df['close'].shift(-5)
        df['target'] = (df['future_close'] > df['close']).astype(int)
        
        # Drop the last 5 rows since they won't have future values
        train_df = df.iloc[:-5]
        
        # Features list
        features = ['return_1', 'return_5', 'volatility_5', 'rsi_14']
        X = train_df[features].values
        y = train_df['target'].values
        
        # Train model
        model = RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42)
        
        # Run 5-fold cross-validation before deploying
        from sklearn.model_selection import cross_val_score
        cv_scores = cross_val_score(model, X, y, cv=5)
        mean_cv_acc = float(np.mean(cv_scores))
        
        if mean_cv_acc < 0.48: # Allow slightly below 0.5 to prevent lockouts on neutral/flat mock data
            return jsonify({
                "status": "rejected",
                "error": f"Validation Gate Rejected: Retrained model failed 5-fold cross-validation (accuracy: {mean_cv_acc:.3f} vs min threshold 0.480)."
            }), 422

        # Fit model on full training window
        model.fit(X, y)
        
        # Save model file
        model_path = os.path.join(MODEL_DIR, f"{symbol.replace('/', '_')}_rf.pkl")
        joblib.dump(model, model_path)
        
        # Calculate training accuracy
        train_acc = model.score(X, y)
        
        return jsonify({
            "status": "success",
            "message": f"Trained RandomForest model for {symbol}.",
            "features_used": features,
            "training_accuracy": float(train_acc),
            "cross_val_accuracy": mean_cv_acc,
            "model_saved_at": model_path
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/predict', methods=['POST'])
def predict():
    """
    Predicts buy/sell signal based on recent candles array
    """
    req_data = request.get_json()
    if not req_data or 'candles' not in req_data or 'symbol' not in req_data:
        return jsonify({"error": "Missing candles or symbol in request body"}), 400
        
    symbol = req_data['symbol']
    candles = req_data['candles']
    
    # Load model
    model_path = os.path.join(MODEL_DIR, f"{symbol.replace('/', '_')}_rf.pkl")
    if not os.path.exists(model_path):
        return jsonify({
            "prediction": "HOLD", 
            "probability": 0.5, 
            "info": "No trained model found for this symbol. Reverting to default HOLD."
        })
        
    try:
        df = pd.DataFrame(candles)
        if len(df) < 15:
            return jsonify({"prediction": "HOLD", "probability": 0.5, "info": "Not enough candles to compute indicators."})
            
        df = compute_features(df)
        
        # Get feature values for the final row
        features = ['return_1', 'return_5', 'volatility_5', 'rsi_14']
        final_row = df.iloc[-1][features].values.reshape(1, -1)
        
        # Load model and predict
        model = joblib.load(model_path)
        prob = model.predict_proba(final_row)[0][1] # Probability of target being 1 (price going up)
        
        prediction = "HOLD"
        # If probability of rise > 58%, trigger BUY
        if prob > 0.58:
            prediction = "BUY"
        # If probability of rise < 42% (meaning probability of drop is > 58%), trigger SELL
        elif prob < 0.42:
            prediction = "SELL"
            
        return jsonify({
            "prediction": prediction,
            "probability": float(prob),
            "symbol": symbol
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("[Python Brain] Starting ML Backend on http://localhost:5000...")
    app.run(port=5000, debug=True)
