import streamlit as st
import pandas as pd
import plotly.graph_objects as go
import numpy as np
from utils import get_stock_data, get_options_chain, format_price_change, get_expiration_dates, calculate_option_profit, get_months_to_expiry, create_price_range_steps, style_profit_table, get_month_year_headers
from datetime import datetime

# Page configuration and CSS loading remain unchanged
st.set_page_config(
    page_title="Stock & Options Viewer",
    page_icon="📈",
    layout="wide"
)

with open("styles.css") as f:
    st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)

# Initialize session states
if 'selected_call' not in st.session_state:
    st.session_state.selected_call = None
if 'selected_put' not in st.session_state:
    st.session_state.selected_put = None
if 'price_range' not in st.session_state:
    st.session_state.price_range = None

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

            # Volatility Metrics
            st.subheader("Volatility Analysis")

            # Set default price range
            current_price = info['currentPrice']
            price_range = (current_price * 0.8, current_price * 1.2)
            st.session_state.price_range = price_range

            vol_col1, vol_col2 = st.columns(2)

            with vol_col1:
                # Historical Volatility Chart
                fig_vol = go.Figure()
                fig_vol.add_trace(go.Scatter(
                    x=history.index,
                    y=history['Historical_Volatility'],
                    name='30-Day Historical Volatility'
                ))
                # Add price range overlay
                fig_vol.add_hrect(
                    y0=price_range[0],
                    y1=price_range[1],
                    fillcolor="rgba(0,100,255,0.1)",
                    line_width=0,
                    name="Selected Range"
                )
                fig_vol.update_layout(
                    title="Historical Volatility (30-Day)",
                    xaxis_title="Date",
                    yaxis_title="Volatility (%)",
                    height=300,
                    margin=dict(l=0, r=0, t=30, b=0)
                )
                st.plotly_chart(fig_vol, use_container_width=True)

            with vol_col2:
                # Volatility Smile/Skew Chart
                if 'selected_date' in locals() and calls is not None and puts is not None:
                    # Combine calls and puts for volatility smile
                    strikes = []
                    ivs = []

                    # Filter options within selected price range
                    filtered_calls = calls[
                        (calls['strike'] >= price_range[0]) &
                        (calls['strike'] <= price_range[1])
                    ]
                    filtered_puts = puts[
                        (puts['strike'] >= price_range[0]) &
                        (puts['strike'] <= price_range[1])
                    ]

                    # Create volatility smile plot
                    fig_smile = go.Figure()

                    # Add calls IV
                    fig_smile.add_trace(go.Scatter(
                        x=filtered_calls['strike'],
                        y=filtered_calls['impliedVolatility'],
                        name='Calls IV',
                        mode='lines+markers',
                        marker=dict(size=6),
                        line=dict(color='blue')
                    ))

                    # Add puts IV
                    fig_smile.add_trace(go.Scatter(
                        x=filtered_puts['strike'],
                        y=filtered_puts['impliedVolatility'],
                        name='Puts IV',
                        mode='lines+markers',
                        marker=dict(size=6),
                        line=dict(color='red')
                    ))

                    fig_smile.update_layout(
                        title="Volatility Smile",
                        xaxis_title="Strike Price ($)",
                        yaxis_title="Implied Volatility (%)",
                        height=300,
                        margin=dict(l=0, r=0, t=30, b=0)
                    )
                    st.plotly_chart(fig_smile, use_container_width=True)

                # Current Volatility Metrics
                current_hist_vol = history['Historical_Volatility'].iloc[-1]
                st.metric(
                    "Current 30-Day Historical Volatility",
                    f"{current_hist_vol:.2f}%"
                )

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

            # Get available expiration dates
            expiration_dates = get_expiration_dates(ticker_symbol)

            if expiration_dates:
                # Add expiration date selector
                selected_date = st.selectbox(
                    "Select Expiration Date",
                    options=expiration_dates,
                    format_func=lambda x: x.strftime('%Y-%m-%d'),
                    index=0
                )

                # Get options chain for selected date
                calls, puts = get_options_chain(ticker_symbol, selected_date)

                if not calls.empty and not puts.empty:
                    # IV Summary
                    st.subheader("Implied Volatility Summary")
                    iv_col1, iv_col2, iv_col3 = st.columns(3)

                    # Calculate IV metrics with NaN handling
                    atm_calls = calls[calls['moneyness'] == 'ATM']
                    atm_puts = puts[puts['moneyness'] == 'ATM']

                    avg_call_iv = atm_calls['impliedVolatility'].mean() if not atm_calls.empty else 0
                    avg_put_iv = atm_puts['impliedVolatility'].mean() if not atm_puts.empty else 0
                    iv_skew = avg_put_iv - avg_call_iv if (avg_put_iv != 0 and avg_call_iv != 0) else 0

                    with iv_col1:
                        st.metric("ATM Calls IV",
                                    f"{avg_call_iv:.2f}%" if avg_call_iv != 0 else "N/A")

                    with iv_col2:
                        st.metric("ATM Puts IV",
                                    f"{avg_put_iv:.2f}%" if avg_put_iv != 0 else "N/A")

                    with iv_col3:
                        st.metric("IV Skew (P-C)",
                                    f"{iv_skew:.2f}%" if iv_skew != 0 else "N/A")

                    # Options Tables with selectable rows
                    col1, col2 = st.columns(2)

                    with col1:
                        st.markdown("### Calls")
                        # Make calls table selectable
                        selected_call_idx = st.selectbox(
                            "Select Call Option",
                            options=range(len(calls)),
                            format_func=lambda x: f"Strike: ${calls.iloc[x]['strike']:.2f} - IV: {calls.iloc[x]['impliedVolatility']:.1f}%",
                            key="call_selector"
                        )
                        st.session_state.selected_call = calls.iloc[selected_call_idx] if selected_call_idx is not None else None

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
                        # Make puts table selectable
                        selected_put_idx = st.selectbox(
                            "Select Put Option",
                            options=range(len(puts)),
                            format_func=lambda x: f"Strike: ${puts.iloc[x]['strike']:.2f} - IV: {puts.iloc[x]['impliedVolatility']:.1f}%",
                            key="put_selector"
                        )
                        st.session_state.selected_put = puts.iloc[selected_put_idx] if selected_put_idx is not None else None

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

                    # Profit Calculator Section
                    st.subheader("Options Profit Calculator")
                    calc_col1, calc_col2 = st.columns(2)

                    with calc_col1:
                        if st.button("Calculate Call Profit/Loss") and st.session_state.selected_call is not None:
                            option = st.session_state.selected_call
                            strike = option['strike']
                            current_price = info['currentPrice']
                            iv = option['impliedVolatility'] / 100  # Convert from percentage
                            option_price = option['lastPrice']
                            open_interest = option['openInterest']

                            # Get months to expiry
                            months_to_expiry = get_months_to_expiry(selected_date)
                            month_range = range(1, months_to_expiry + 1)

                            # Generate month/year headers
                            month_headers = get_month_year_headers(datetime.now(), months_to_expiry)

                            # Generate price steps
                            price_steps = create_price_range_steps(strike)
                            open_interest_values = [open_interest for _ in price_steps] #Use same open interest for all price steps

                            # Calculate profit table
                            profit_data = []
                            for price, pct_change in price_steps:
                                row = {
                                    'Price': f'${price:.2f}',
                                    '% Change': f'{pct_change}%'
                                }
                                for i, month in enumerate(month_range):
                                    profit = calculate_option_profit(
                                        current_price=current_price,
                                        strike=strike,
                                        option_price=option_price,
                                        volatility=iv,
                                        time_to_expiry=month/12,
                                        is_call=True,
                                        target_price=price
                                    )
                                    row[month_headers[i]] = f'{profit:.1f}%'
                                profit_data.append(row)

                            profit_df = pd.DataFrame(profit_data)
                            styled_df = style_profit_table(profit_df, open_interest=open_interest_values)
                            st.dataframe(styled_df, height=400)

                    with calc_col2:
                        if st.button("Calculate Put Profit/Loss") and st.session_state.selected_put is not None:
                            option = st.session_state.selected_put
                            strike = option['strike']
                            current_price = info['currentPrice']
                            iv = option['impliedVolatility'] / 100  # Convert from percentage
                            option_price = option['lastPrice']
                            open_interest = option['openInterest']

                            # Get months to expiry
                            months_to_expiry = get_months_to_expiry(selected_date)
                            month_range = range(1, months_to_expiry + 1)

                            # Generate month/year headers
                            month_headers = get_month_year_headers(datetime.now(), months_to_expiry)

                            # Generate price steps
                            price_steps = create_price_range_steps(strike)
                            open_interest_values = [open_interest for _ in price_steps] #Use same open interest for all price steps

                            # Calculate profit table
                            profit_data = []
                            for price, pct_change in price_steps:
                                row = {
                                    'Price': f'${price:.2f}',
                                    '% Change': f'{pct_change}%'
                                }
                                for i, month in enumerate(month_range):
                                    profit = calculate_option_profit(
                                        current_price=current_price,
                                        strike=strike,
                                        option_price=option_price,
                                        volatility=iv,
                                        time_to_expiry=month/12,
                                        is_call=False,
                                        target_price=price
                                    )
                                    row[month_headers[i]] = f'{profit:.1f}%'
                                profit_data.append(row)

                            profit_df = pd.DataFrame(profit_data)
                            styled_df = style_profit_table(profit_df, open_interest=open_interest_values)
                            st.dataframe(styled_df, height=400)

                else:
                    st.warning("No options data available for the selected date.")
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