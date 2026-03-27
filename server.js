const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 你的 Lark 应用配置
const LARK_APP_ID = 'cli_a930dc1e38f85eef';
const LARK_APP_SECRET = 'JbXSDhF6SSHGZNpnA1ziAdoBVX7S1D6B';

// 多维表配置
const APP_TOKEN = 'YQnObs64caRIz4svewjlrtBFgoc';
// 修正后的表 ID（只取 tbl 开头到 & 之前的部分）
const SEED_TABLE_ID = 'tblus0Qa3Uj4artl';      // 种子用户表
const REDEEM_TABLE_ID = 'tblgHMKeMODfXUD6';    // 唯一码核销表

// 缓存 token
let cachedToken = null;
let tokenExpireTime = 0;

async function getTenantAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && now < tokenExpireTime) {
        return cachedToken;
    }

    try {
        const response = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_id: LARK_APP_ID,
                app_secret: LARK_APP_SECRET
            })
        });
        const data = await response.json();

        if (data.tenant_access_token) {
            cachedToken = data.tenant_access_token;
            tokenExpireTime = now + (data.expire || 7200) - 60;
            return cachedToken;
        } else {
            throw new Error(`获取 token 失败: ${JSON.stringify(data)}`);
        }
    } catch (error) {
        console.error('获取 token 错误:', error);
        return null;
    }
}

// 根据唯一核销码查询推荐人信息
app.post('/query-by-code', async (req, res) => {
    try {
        const { code } = req.body;
        console.log('查询核销码:', code);
        
        if (!code) {
            return res.status(400).json({ error: '缺少核销码' });
        }

        const token = await getTenantAccessToken();
        if (!token) {
            return res.status(500).json({ error: '无法获取访问令牌' });
        }

        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${SEED_TABLE_ID}/records/search`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                field_names: ["唯一核销码", "推荐人姓名", "推荐人电话"],
                filter: {
                    conjunction: "and",
                    conditions: [{
                        field_name: "唯一核销码",
                        operator: "is",
                        value: [code]
                    }]
                }
            })
        });

        const result = await response.json();
        console.log('Lark 查询返回:', JSON.stringify(result, null, 2));
        
        if (result.code === 0 && result.data && result.data.items && result.data.items.length > 0) {
            const fields = result.data.items[0].fields;
            
            // 解析字段值（处理 Lark 返回的复杂格式）
            function extractValue(field) {
                if (!field) return null;
                if (typeof field === 'string') return field;
                if (Array.isArray(field)) {
                    if (field.length === 0) return null;
                    const first = field[0];
                    if (typeof first === 'string') return first;
                    if (first && first.text) return first.text;
                    return String(first);
                }
                if (field.value !== undefined) {
                    const val = field.value;
                    if (Array.isArray(val) && val.length > 0) {
                        if (typeof val[0] === 'string') return val[0];
                        if (val[0] && val[0].text) return val[0].text;
                        return String(val[0]);
                    }
                    return String(val);
                }
                if (field.text) return field.text;
                return String(field);
            }
            
            const name = extractValue(fields["推荐人姓名"]);
            const phone = extractValue(fields["推荐人电话"]);
            
            res.json({
                success: true,
                data: {
                    code: code,
                    name: name || '—',
                    phone: phone || '—'
                }
            });
        } else {
            console.log('未找到核销码:', code);
            res.json({ success: false, message: '未找到该核销码' });
        }
    } catch (error) {
        console.error('查询错误:', error);
        res.status(500).json({ error: error.message });
    }
});

// 提交核销记录
app.post('/submit-redeem', async (req, res) => {
    try {
        const { redeemCode, referrerName, referrerPhone, redeemerName, redeemerPhone, orderRemark } = req.body;
        
        console.log('提交核销:', { redeemCode, referrerName, referrerPhone, redeemerName, redeemerPhone });
        
        if (!redeemCode || !referrerName || !referrerPhone || !redeemerName || !redeemerPhone) {
            return res.status(400).json({ error: '缺少必填字段' });
        }

        const token = await getTenantAccessToken();
        if (!token) {
            return res.status(500).json({ error: '无法获取访问令牌' });
        }

        // 获取当前时间戳
        const now = new Date();
        const timestamp = now.getTime();
        
        const newRecord = {
            "核销日期": timestamp,
            "核销码": redeemCode,
            "推荐人姓名": referrerName,
            "推荐人电话": referrerPhone,
            "兑换人姓名": redeemerName,
            "兑换人电话": redeemerPhone,
            "订单备注": orderRemark || ''
        };

        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${REDEEM_TABLE_ID}/records`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: newRecord })
        });

        const result = await response.json();
        console.log('提交结果:', result);
        
        if (result.code === 0) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: result.msg });
        }
    } catch (error) {
        console.error('提交错误:', error);
        res.status(500).json({ error: error.message });
    }
});

// 健康检查
app.get('/', (req, res) => {
    res.send('Lark Redeem Proxy is running');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Proxy running on port ${port}`);
    console.log(`种子用户表 ID: ${SEED_TABLE_ID}`);
    console.log(`核销表 ID: ${REDEEM_TABLE_ID}`);
});
