import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import streamlit as st
from scipy.stats import norm

@st.cache_resource
def get_ticker(ticker_symbol):
    """
    Get ticker object using cache_resource since it's not serializable
    """
    try:
        return yf.Ticker(ticker_symbol)
    except Exception as e:
        raise Exception(f"Error creating ticker for {ticker_symbol}: {str(e)}")

def calculate_historical_volatility(history, window=30):
    """
    Calculate historical volatility using daily returns
    """
    # Calculate daily returns
    returns = np.log(history['Close'] / history['Close'].shift(1))
    # Calculate rolling standard deviation
    hist_vol = returns.rolling(window=window).std() * np.sqrt(252) * 100
    return hist_vol

def black_scholes(S, K, T, r, sigma, is_call=True):
    """
    Calculate option price using Black-Scholes model
    S: Current stock price
    K: Strike price
    T: Time to expiration (in years)
    r: Risk-free interest rate (assumed 0.05 for simplicity)
    sigma: Volatility
    """
    if T <= 0:
        # For expired options, calculate intrinsic value
        if is_call:
            return max(S - K, 0)
        else:
            return max(K - S, 0)

    d1 = (np.log(S/K) + (r + sigma**2/2)*T) / (sigma*np.sqrt(T))
    d2 = d1 - sigma*np.sqrt(T)

    if is_call:
        price = S*norm.cdf(d1) - K*np.exp(-r*T)*norm.cdf(d2)
    else:
        price = K*np.exp(-r*T)*norm.cdf(-d2) - S*norm.cdf(-d1)

    return price

def calculate_option_profit(current_price, strike, option_price, volatility, 
                          time_to_expiry, is_call, target_price):
    """
    Calculate the profit/loss percentage for an option position
    """
    r = 0.05  # Risk-free rate assumption

    # Calculate new option value at target price
    new_value = black_scholes(target_price, strike, time_to_expiry, r, volatility, is_call)

    # Calculate profit/loss percentage
    profit = (new_value - option_price) / option_price * 100

    return profit

def get_months_to_expiry(expiry_date):
    """
    Calculate the number of months between now and expiry date
    """
    today = datetime.now().date()
    expiry = datetime.strptime(expiry_date.strftime('%Y-%m-%d'), '%Y-%m-%d').date()
    delta = expiry - today
    return max(1, round(delta.days / 30))

def create_price_range_steps(current_price):
    """
    Create price range with 5% steps from -100% to +100%
    """
    steps = []
    for pct in range(-100, 101, 5):
        price = current_price * (1 + pct/100)
        if price > 0:  # Avoid negative prices
            steps.append((price, pct))
    return steps

def get_month_year_headers(current_date, months_count):
    """
    Generate month and year headers for the profit table
    """
    headers = []
    for i in range(months_count):
        next_date = current_date + timedelta(days=30 * (i + 1))
        headers.append(next_date.strftime('%b %Y'))
    return headers

def style_profit_table(df, open_interest=None):
    """
    Apply color gradient styling to profit/loss values and open interest
    """
    def color_profit_loss(val):
        try:
            value = float(val.strip('%'))
            if value > 0:
                # Green gradient for profits
                intensity = min(value / 200, 1)  # Max intensity at 200% profit
                return f'background-color: rgba(0, 255, 0, {intensity})'
            elif value < 0:
                # Red gradient for losses
                intensity = min(abs(value) / 200, 1)  # Max intensity at 200% loss
                return f'background-color: rgba(255, 0, 0, {intensity})'
            return ''
        except:
            return ''

    def color_open_interest(val):
        if open_interest is None or val not in open_interest:
            return ''
        # Get the relative intensity based on open interest
        max_oi = max(open_interest)
        min_oi = min(open_interest)
        if max_oi == min_oi:
            intensity = 0.5
        else:
            intensity = (val - min_oi) / (max_oi - min_oi)
        return f'background-color: rgba(128, 128, 128, {intensity})'

    # Create a styler object
    styler = df.style

    # Apply profit/loss coloring to numeric columns (excluding Price and % Change)
    numeric_columns = df.columns.difference(['Price', '% Change'])
    styler = styler.applymap(color_profit_loss, subset=numeric_columns)

    # Apply open interest coloring to Price column if open interest data is provided
    if open_interest is not None:
        styler = styler.applymap(color_open_interest, subset=['Price'])

    return styler


@st.cache_data(ttl=300)  # Cache data for 5 minutes
def get_stock_data(ticker_symbol):
    """
    Fetch stock data using yfinance with proper caching
    Returns serializable data only
    """
    try:
        ticker = get_ticker(ticker_symbol)

        # Get current price with fallbacks
        current_price = (
            ticker.info.get('currentPrice') or 
            ticker.info.get('regularMarketPrice') or 
            ticker.info.get('previousClose')
        )

        if not current_price:
            raise Exception(f"Unable to get price data for {ticker_symbol}")

        # Get info and convert to dict with safe fallbacks
        info = {
            'longName': ticker.info.get('longName', ticker_symbol),
            'currentPrice': float(current_price),
            'previousClose': float(ticker.info.get('previousClose', current_price)),
            'dayHigh': float(ticker.info.get('dayHigh', current_price)),
            'dayLow': float(ticker.info.get('dayLow', current_price)),
            'volume': int(ticker.info.get('volume', 0) or 0),
            'averageVolume': int(ticker.info.get('averageVolume', 0) or 0)
        }

        # Get history and calculate volatility with error handling
        try:
            history = ticker.history(period="1y")
            if history.empty:
                raise Exception("No historical data available")
            history['Historical_Volatility'] = calculate_historical_volatility(history)
        except Exception as e:
            raise Exception(f"Error fetching historical data: {str(e)}")

        return info, history

    except Exception as e:
        raise Exception(f"Error fetching data for {ticker_symbol}: {str(e)}")

@st.cache_data(ttl=300)
def get_expiration_dates(ticker_symbol):
    """
    Get available option expiration dates
    """
    try:
        ticker = get_ticker(ticker_symbol)
        dates = ticker.options
        # Convert to datetime objects for better display
        return [datetime.strptime(date, '%Y-%m-%d').date() for date in dates]
    except Exception as e:
        raise Exception(f"Error fetching expiration dates: {str(e)}")

def categorize_moneyness(strike, current_price):
    """
    Categorize options as ITM, ATM, or OTM with a wider ATM range
    """
    percent_diff = abs(strike - current_price) / current_price
    if percent_diff <= 0.02:  # 2% range for ATM
        return 'ATM'
    elif strike < current_price:
        return 'ITM'
    else:
        return 'OTM'

@st.cache_data(ttl=300)
def get_options_chain(ticker_symbol, expiration_date):
    """
    Fetch options chain data with caching and improved error handling
    """
    try:
        ticker = get_ticker(ticker_symbol)

        # Format date back to string format required by yfinance
        expiration_str = expiration_date.strftime('%Y-%m-%d')

        # Get current price with fallbacks
        current_price = (
            ticker.info.get('currentPrice') or 
            ticker.info.get('regularMarketPrice') or 
            ticker.info.get('previousClose')
        )

        if not current_price:
            raise Exception(f"Unable to get current price for {ticker_symbol}")

        # Get options chain for the selected expiration
        try:
            options = ticker.option_chain(expiration_str)
        except Exception as e:
            raise Exception(f"Error fetching options chain: {str(e)}")

        # Clean and format calls dataframe
        try:
            calls = options.calls[['strike', 'lastPrice', 'bid', 'ask', 'volume', 'openInterest', 'impliedVolatility']]
            calls = calls.fillna(0)  # Fill NaN values with 0
            calls = calls.round(2)
            calls['impliedVolatility'] = (calls['impliedVolatility'] * 100).round(2)
            calls['moneyness'] = calls['strike'].apply(lambda x: categorize_moneyness(x, current_price))
        except Exception as e:
            raise Exception(f"Error processing calls data: {str(e)}")

        # Clean and format puts dataframe
        try:
            puts = options.puts[['strike', 'lastPrice', 'bid', 'ask', 'volume', 'openInterest', 'impliedVolatility']]
            puts = puts.fillna(0)  # Fill NaN values with 0
            puts = puts.round(2)
            puts['impliedVolatility'] = (puts['impliedVolatility'] * 100).round(2)
            puts['moneyness'] = puts['strike'].apply(lambda x: categorize_moneyness(x, current_price))
        except Exception as e:
            raise Exception(f"Error processing puts data: {str(e)}")

        return calls, puts
    except Exception as e:
        raise Exception(f"Error fetching options data: {str(e)}")

def format_price_change(change, percentage=False):
    """
    Format price change with color coding
    """
    if percentage:
        formatted = f"{change:.2f}%"
    else:
        formatted = f"${change:.2f}"

    if change > 0:
        return f"<span class='price-change-positive'>+{formatted}</span>"
    elif change < 0:
        return f"<span class='price-change-negative'>{formatted}</span>"
    return formatted