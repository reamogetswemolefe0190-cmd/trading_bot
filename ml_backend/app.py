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
    df = df.fillna(method='bfill').fillna(0)
    return df

@app.route('/train', methods=['POST'])
def train():
    """
    Trains a RandomForest model on a historical candles JSON file
    """
    req_data = request.get_json()
    if not req_data or 'filepath' not in req_data or 'symbol' not in req_data:
        return jsonify({"error": "Missing filepath or symbol in request body"}), 400
        
    filepath = req_data['filepath']
    symbol = req_data['symbol']
    
    if not os.path.exists(filepath):
        return jsonify({"error": f"File not found: {filepath}"}), 404
        
    try:
        # Load JSON candles history
        with open(filepath, 'r') as f:
            candles = json.load(f)
            
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
        model.fit(X, y)
        
        # Save model file
        model_path = os.path.join(MODEL_DIR, f"{symbol.replace('/', '_')}_rf.pkl")
        joblib.dump(model, model_path)
        
        # Calculate training win accuracy (dummy check)
        train_acc = model.score(X, y)
        
        return jsonify({
            "status": "success",
            "message": f"Trained RandomForest model for {symbol}.",
            "features_used": features,
            "training_accuracy": float(train_acc),
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
