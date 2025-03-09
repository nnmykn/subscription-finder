import React, { useRef, useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, Cell, TooltipProps, ResponsiveContainer } from 'recharts';

export interface DataPoint {
  number: string;
  count: number;
  rank: number;
  percentage: number;
}

interface ScrollableBarChartProps {
  data: DataPoint[];
  numberColorMap: { [key: number]: string };
  referenceLineY?: number;
  onVisibleRangeChange: (start: number, end: number) => void;
  tooltipComponent: React.FC<TooltipProps<number, string>>;
}

const ScrollableBarChart: React.FC<ScrollableBarChartProps> = ({
  data,
  numberColorMap,
  referenceLineY = 29,
  onVisibleRangeChange,
  tooltipComponent: TooltipComponent
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chartDimensions, setChartDimensions] = useState({ width: 0, height: 0 });

  const maxCount = Math.max(...data.map(item => item.count));
  const yAxisDomain = [0, Math.ceil(maxCount * 1.1)];

  const margin = { top: 20, right: 30, left: 10, bottom: 40 };
  const barWidth = 60;
  const yAxisWidth = 60;
  const graphHeight = 300; // 明示的にグラフの高さを指定

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { clientWidth } = containerRef.current;
        setChartDimensions({
          width: Math.max(data.length * barWidth, clientWidth - yAxisWidth),
          height: graphHeight
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [data.length]);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      const { scrollLeft, clientWidth } = containerRef.current;
      const startIndex = Math.floor(scrollLeft / barWidth);
      const endIndex = Math.min(Math.floor((scrollLeft + clientWidth - yAxisWidth) / barWidth), data.length - 1);
      onVisibleRangeChange(startIndex + 1, endIndex + 1);
    }
  }, [data.length, onVisibleRangeChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      handleScroll();
    }
    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
    };
  }, [handleScroll]);

  return (
    <div className="relative w-full" style={{ height: `${graphHeight + margin.top + margin.bottom}px` }} ref={containerRef}>
      {/* Fixed Y-Axis */}
      <div className="absolute left-0 top-0 bg-white" style={{ width: `${yAxisWidth}px`, height: `${graphHeight + margin.top}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ ...margin, left: 0 }}>
            <YAxis
              domain={yAxisDomain}
              axisLine={true}
              tickLine={true}
              tickCount={6}
              allowDataOverflow={true}
              width={yAxisWidth}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      
      {/* Scrollable Chart Area */}
      <div className="overflow-x-auto overflow-y-hidden" style={{ marginLeft: `${yAxisWidth}px`, height: `${graphHeight + margin.top + margin.bottom}px` }}>
        <div style={{ width: `${chartDimensions.width}px`, height: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={margin}
            >
              <XAxis dataKey="number" />
              <YAxis
                domain={yAxisDomain}
                hide
                allowDataOverflow={true}
              />
              <Tooltip content={<TooltipComponent />} />
              <ReferenceLine y={referenceLineY} stroke="#888888" strokeDasharray="3 3" />
              <Bar dataKey="count" maxBarSize={50}>
                {data.map((entry) => (
                  <Cell
                    key={`cell-${entry.number}`}
                    fill={numberColorMap[parseInt(entry.number)]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default ScrollableBarChart;