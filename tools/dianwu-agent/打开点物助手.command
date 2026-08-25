#!/bin/bash
cd "$(dirname "$0")"
echo "点物助手"
echo "不要关这个窗口。回到网站点同步即可。"
echo
if command -v python3 >/dev/null 2>&1; then
  exec python3 "./helper.py"
fi
if command -v node >/dev/null 2>&1; then
  exec node "./start.cjs"
fi
echo "这台电脑缺少运行环境。苹果电脑一般自带 Python。"
echo "没有的话，先装 https://www.python.org/downloads/ 再双击一次。"
read -r _
