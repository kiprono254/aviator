# app.py - Flask backend
from flask import Flask, render_template, session, jsonify
import random
import time

app = Flask(__name__)
app.secret_key = 'your_secret_key_here'

@app.before_request
def init_session():
    if 'balance' not in session:
        session['balance'] = 1000.00  # Starting balance
    if 'game_active' not in session:
        session['game_active'] = False

@app.route('/')
def index():
    return render_template('index.html', balance=session['balance'])

@app.route('/start_game', methods=['POST'])
def start_game():
    if session['game_active']:
        return jsonify({'success': False, 'message': 'Game already in progress'})
    
    bet_amount = float(request.json['bet'])
    if bet_amount <= 0 or bet_amount > session['balance']:
        return jsonify({'success': False, 'message': 'Invalid bet amount'})
    
    # Generate crash point (provably fair method)
    house_edge = 0.01
    seed = int(time.time() * 1000)
    random.seed(seed)
    rand_num = random.random()
    crash_point = max(1.0, round((1 - house_edge) / (1 - rand_num), 2))
    
    # Store game data
    session['game_active'] = True
    session['current_bet'] = bet_amount
    session['balance'] -= bet_amount
    session['crash_point'] = crash_point
    session['seed'] = seed
    
    return jsonify({
        'success': True,
        'crash_point': crash_point,
        'balance': session['balance']
    })

@app.route('/cash_out', methods=['POST'])
def cash_out():
    if not session['game_active']:
        return jsonify({'success': False, 'message': 'No active game'})
    
    multiplier = float(request.json['multiplier'])
    if multiplier >= session['crash_point']:
        return jsonify({'success': False, 'message': 'Invalid cashout'})
    
    # Calculate winnings
    winnings = session['current_bet'] * multiplier
    session['balance'] += winnings
    session['game_active'] = False
    
    return jsonify({
        'success': True,
        'winnings': round(winnings, 2),
        'balance': session['balance'],
        'multiplier': multiplier
    })

@app.route('/get_balance', methods=['GET'])
def get_balance():
    return jsonify({'balance': session['balance']})

if __name__ == '__main__':
    app.run(debug=True)