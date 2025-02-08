import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
import streamlit as st

@st.cache_resource
def get_ticker(ticker_symbol):
    """
    Get ticker object using cache_resource since it's not serializable
    """
    try:
        return yf.Ticker(ticker_symbol)
    except Exception as e:
        raise Exception(f"Error creating ticker for {ticker_symbol}: {str(e)}")

@st.cache_data(ttl=300)  # Cache data for 5 minutes
def get_stock_data(ticker_symbol):
    """
    Fetch stock data using yfinance with proper caching
    Returns serializable data only
    """
    try:
        ticker = get_ticker(ticker_symbol)

        # Get info and convert to dict
        info = {
            'longName': ticker.info.get('longName', ticker_symbol),
            'currentPrice': ticker.info.get('currentPrice', 0.0),
            'previousClose': ticker.info.get('previousClose', 0.0),
            'dayHigh': ticker.info.get('dayHigh', 0.0),
            'dayLow': ticker.info.get('dayLow', 0.0),
            'volume': ticker.info.get('volume', 0),
            'averageVolume': ticker.info.get('averageVolume', 0)
        }

        # Get history
        history = ticker.history(period="1y")

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

@st.cache_data(ttl=300)
def get_options_chain(ticker_symbol, expiration_date):
    """
    Fetch options chain data with caching
    """
    try:
        ticker = get_ticker(ticker_symbol)

        # Format date back to string format required by yfinance
        expiration_str = expiration_date.strftime('%Y-%m-%d')

        # Get options chain for the selected expiration
        options = ticker.option_chain(expiration_str)

        # Clean and format calls dataframe
        calls = options.calls[['strike', 'lastPrice', 'bid', 'ask', 'volume', 'openInterest', 'impliedVolatility']]
        calls = calls.round(2)
        calls['impliedVolatility'] = (calls['impliedVolatility'] * 100).round(2)

        # Clean and format puts dataframe
        puts = options.puts[['strike', 'lastPrice', 'bid', 'ask', 'volume', 'openInterest', 'impliedVolatility']]
        puts = puts.round(2)
        puts['impliedVolatility'] = (puts['impliedVolatility'] * 100).round(2)

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