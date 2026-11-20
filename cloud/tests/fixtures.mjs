/* Deterministic synthetic structures for unit tests.
 * These are fixture values, not market-data forecasts.
 */
export const structureFixture = () => ({
  oneClosedAt: 1200,
  three: {
    trend:'UP',price:1795,prevClose:1794.5,range:1,e8:1794,e21:1793,rsi:60,
    bands:{lower:1788,upper:1801,mid:1795,width:.01},
    adDelta:20,support:null,resistance:null,tolerance:1,closedAt:1200
  },
  five: {
    trend:'UP',price:1795,prevClose:1794,range:2,e8:1793,e21:1792,rsi:60,
    bands:{lower:1787,upper:1803,mid:1795,width:.01},
    adDelta:22,support:null,resistance:null,tolerance:1
  },
  regime:{status:'unavailable',regime:'UNKNOWN',eventRisk:'unverified'}
});
