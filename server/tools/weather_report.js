export default {
  name: 'weather_report',
  description: '获取指定城市的天气信息',
  parameters: {
    city: { type: 'string', description: '城市名称（如：北京、上海、New York）', required: true }
  },
  execute: async ({ city }) => {
    try {
      // 1. 获取城市的经纬度 (使用 Open-Meteo 免费地理编码 API)
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`);
      const geoData = await geoRes.json();
      
      if (!geoData.results || geoData.results.length === 0) {
        return `无法找到城市 "${city}" 的坐标，请检查拼写。`;
      }
      
      const { latitude, longitude, name, country } = geoData.results[0];

      // 2. 获取天气 (使用 Open-Meteo 免费天气 API)
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`);
      const weatherData = await weatherRes.json();
      
      const current = weatherData.current;
      
      // 简单的天气代码转换
      const weatherCodeMap = {
        0: '晴朗', 1: '大部晴朗', 2: '多云', 3: '阴天', 
        45: '雾', 48: '沉积雾', 
        51: '毛毛雨', 53: '中等毛毛雨', 55: '密集毛毛雨', 
        61: '小雨', 63: '中雨', 65: '大雨', 
        71: '小雪', 73: '中雪', 75: '大雪',
        95: '雷暴', 96: '雷暴伴有轻微冰雹', 99: '雷暴伴有重度冰雹'
      };
      
      const condition = weatherCodeMap[current.weather_code] || '未知天气';

      return `[${name}, ${country}] 当前天气:
气温: ${current.temperature_2m}°C
天气状况: ${condition}
湿度: ${current.relative_humidity_2m}%
风速: ${current.wind_speed_10m} km/h`;

    } catch (error) {
      return `获取天气失败: ${error.message}。\n💡 提示：此工具需要访问境外 Open-Meteo 气象服务。如果您处于国内网络环境，请在根目录的 '.env' 文件中配置本地代理（例如追加：HTTPS_PROXY=http://127.0.0.1:你的代理端口），然后重新启动项目。`;
    }
  }
};
