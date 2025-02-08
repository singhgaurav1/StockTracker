import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from utils import get_stock_data, get_options_chain, format_price_change

# Page configuration
st.set_page_config(
    page_title="Stock & Options Viewer",
    page_icon="📈",
    layout="wide"
)

# Load custom CSS
with open("styles.css") as f:
    st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)

# Header
st.title("📈 Stock & Options Viewer")

# Input section
col1, col2 = st.columns([2, 1])
with col1:
    ticker_symbol = st.text_input("Enter Stock Ticker", value="AAPL").upper()
with col2:
    refresh_button = st.button("🔄 Refresh Data")

try:
    if ticker_symbol:
        with st.spinner('Loading data...'):
            # Fetch stock data
            info, history = get_stock_data(ticker_symbol)

            # Display stock info
            col1, col2, col3 = st.columns([2, 1, 1])

            with col1:
                st.markdown(f"### {info['longName']} ({ticker_symbol})")
                current_price = info['currentPrice']
                previous_close = info['previousClose']
                price_change = current_price - previous_close
                price_change_percent = (price_change / previous_close) * 100

                st.markdown(
                    f"<div class='stock-price'>${current_price:.2f}</div>",
                    unsafe_allow_html=True
                )
                st.markdown(
                    f"{format_price_change(price_change)} ({format_price_change(price_change_percent, percentage=True)})",
                    unsafe_allow_html=True
                )

            with col2:
                st.metric("Day High", f"${info['dayHigh']:.2f}")
                st.metric("Volume", f"{info['volume']:,}")

            with col3:
                st.metric("Day Low", f"${info['dayLow']:.2f}")
                st.metric("Avg Volume", f"{info['averageVolume']:,}")

            # Price Chart
            st.subheader("Price History")
            fig = go.Figure(data=[go.Candlestick(x=history.index,
                                                open=history['Open'],
                                                high=history['High'],
                                                low=history['Low'],
                                                close=history['Close'])])
            fig.update_layout(
                xaxis_title="Date",
                yaxis_title="Price ($)",
                height=500,
                margin=dict(l=0, r=0, t=0, b=0)
            )
            st.plotly_chart(fig, use_container_width=True)

            # Options Chain
            st.subheader("Options Chain")
            calls, puts = get_options_chain(ticker_symbol)

            if not calls.empty and not puts.empty:
                col1, col2 = st.columns(2)

                with col1:
                    st.markdown("### Calls")
                    st.dataframe(
                        calls.style.format({
                            'strike': '${:.2f}',
                            'lastPrice': '${:.2f}',
                            'bid': '${:.2f}',
                            'ask': '${:.2f}',
                            'impliedVolatility': '{:.2f}%'
                        }),
                        height=400
                    )

                with col2:
                    st.markdown("### Puts")
                    st.dataframe(
                        puts.style.format({
                            'strike': '${:.2f}',
                            'lastPrice': '${:.2f}',
                            'bid': '${:.2f}',
                            'ask': '${:.2f}',
                            'impliedVolatility': '{:.2f}%'
                        }),
                        height=400
                    )
            else:
                st.warning("No options data available for this ticker.")

except Exception as e:
    st.error(f"Error: {str(e)}")
    st.info("Please check the ticker symbol and try again.")

# Footer
st.markdown("---")
st.markdown(
    """
    <div style='text-align: center'>
        <small>Data provided by Yahoo Finance. Refresh data every 5 minutes for latest updates.</small>
    </div>
    """,
    unsafe_allow_html=True
)