import Watchlist from '../components/Watchlist.jsx';
import Chart from '../components/Chart.jsx';
import OrderTicket from '../components/OrderTicket.jsx';
import OrderBook from '../components/OrderBook.jsx';
import BottomPanel from '../components/BottomPanel.jsx';

export default function Trade() {
  return (
    <div className="trade">
      <div className="a-watch"><Watchlist /></div>
      <div className="a-chart"><Chart /></div>
      <div className="a-side">
        <OrderTicket />
        <OrderBook />
      </div>
      <div className="a-bottom"><BottomPanel /></div>
    </div>
  );
}
