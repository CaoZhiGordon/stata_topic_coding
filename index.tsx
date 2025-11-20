import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
import {
  Play,
  Save,
  FileText,
  Settings,
  Database,
  BarChart3,
  Sigma,
  Copy,
  Terminal,
  Layers,
  Variable,
  GitBranch,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  BookOpen,
  Cpu,
  Download,
  SlidersHorizontal,
  Workflow,
  Anchor,
  PieChart,
  TrendingUp,
  Activity,
  Zap
} from "lucide-react";

// --- Configuration ---
const STATA_BLUE = "#1a4e8a"; // Classic Stata Header Color
const STATA_BG = "#f0f2f5";

// --- Types ---
interface VariableDef {
  name: string;
  label: string;
  role: 'Y' | 'X' | 'Control' | 'Mechanism' | 'Hetero' | 'FixedEffect';
}

interface CodeSection {
  title: string;
  code: string;
  explanation: string;
}

interface AnalysisMethod {
  name: string;
  cmd: string; // Hint for the AI or display
}

// --- Helper: Syntax Highlighting for Stata ---
const StataCodeBlock = ({ code }: { code: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Simple regex-based syntax highlighting for display
  const highlight = (text: string) => {
    const keywords = /\b(reg|reghdfe|sum|summarize|ivreg2|xtreg|gen|egen|tab|keep|drop|merge|append|use|clear|global|local|foreach|if|else|esttab|outreg2|winsor2|psmatch2|sgmediation|sem|xtabond|xtabond2|logit|probit|poisson|nbreg|tobit|ppmlhdfe|stepwise|vif|pwcorr|spearman|xtunitroot|swilk|hettest|kdensity|mdesc|extremes|xtline|rdrobust|synth|xthreg|sqreg)\b/g;
    const options = /\,[\s\w\(\)\*]+/g; // crudely match options after comma
    const comments = /(\*.*|\/\/.*)/g;
    const macros = /(\$[a-zA-Z0-9_]+|\`[a-zA-Z0-9_]+\')/g;

    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    
    html = html
      .replace(comments, '<span class="text-green-600 italic">$1</span>')
      .replace(keywords, '<span class="text-blue-700 font-bold">$1</span>')
      .replace(macros, '<span class="text-red-700 font-semibold">$1</span>');
      
    return { __html: html };
  };

  return (
    <div className="relative group border border-gray-200 rounded-md shadow-sm bg-white my-4">
      <div className="flex items-center justify-between px-3 py-1 bg-gray-100 border-b border-gray-200 text-xs font-mono text-gray-600">
        <span className="flex items-center gap-2"><Terminal size={12} /> Do-file Editor</span>
        <button 
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-blue-600 transition-colors"
        >
          {copied ? <CheckCircle2 size={12} className="text-green-600" /> : <Copy size={12} />}
          {copied ? "复制" : "复制"}
        </button>
      </div>
      <div className="p-4 overflow-x-auto bg-white font-mono text-sm leading-relaxed">
        <pre dangerouslySetInnerHTML={highlight(code)} className="whitespace-pre-wrap" />
      </div>
    </div>
  );
};

// --- Main Application ---

const App = () => {
  const [apiKey] = useState(process.env.API_KEY);
  const [ai] = useState(new GoogleGenAI({ apiKey: process.env.API_KEY }));
  
  // State
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1: Topic, 2: Vars, 3: Analysis
  const [loading, setLoading] = useState(false);
  
  // Research Data
  const [topic, setTopic] = useState("");
  const [field, setField] = useState("发展经济学 (Development Economics)");
  const [controlCount, setControlCount] = useState(4);
  const [heteroCount, setHeteroCount] = useState(1);
  const [mechCount, setMechCount] = useState(1);
  const [feCount, setFeCount] = useState(2); // Default Fixed Effects (e.g. Year, City)
  const [variables, setVariables] = useState<VariableDef[]>([]);
  
  // Analysis Generation State
  const [activeTab, setActiveTab] = useState("basic"); // basic, benchmark, robust, endo, hetero
  const [generatedContent, setGeneratedContent] = useState<Record<string, CodeSection[]>>({
    basic: [], benchmark: [], robust: [], endo: [], hetero: []
  });

  // --- Analysis Methods Definition ---
  const analysisMethods: Record<string, AnalysisMethod[]> = {
    basic: [
      { name: '描述性统计 (Detail)', cmd: 'sum, detail' },
      { name: '相关性矩阵 (Pearson)', cmd: 'pwcorr' },
      { name: 'Spearman 相关性', cmd: 'spearman' },
      { name: '方差膨胀因子 (VIF)', cmd: 'vif' },
      { name: '单位根检验 (Panel)', cmd: 'xtunitroot' },
      { name: '正态性检验 (SW)', cmd: 'swilk' },
      { name: '异方差检验 (White)', cmd: 'estat hettest' },
      { name: '散点图矩阵', cmd: 'graph matrix' },
      { name: '核密度估计图', cmd: 'kdensity' },
      { name: '缺失值分析', cmd: 'mdesc' },
      { name: '极端值检测', cmd: 'extremes' },
      { name: '时间趋势图', cmd: 'xtline' }
    ],
    benchmark: [
      { name: '双向固定效应 (Two-way FE)', cmd: 'reghdfe' },
      { name: '混合 OLS (Pooled OLS)', cmd: 'reg, r' },
      { name: '随机效应模型 (RE)', cmd: 'xtreg, re' },
      { name: '逐步回归法 (Stepwise)', cmd: 'stepwise' },
      { name: 'Logit 模型 (二值)', cmd: 'logit' },
      { name: 'Probit 模型 (二值)', cmd: 'probit' },
      { name: '泊松回归 (计数)', cmd: 'poisson' },
      { name: '负二项回归 (计数)', cmd: 'nbreg' },
      { name: 'Tobit 模型 (截断)', cmd: 'tobit' },
      { name: 'PPML 回归 (引力模型)', cmd: 'ppmlhdfe' },
      { name: '高维固定效应 (HDFE)', cmd: 'reghdfe' },
      { name: '标准化系数回归', cmd: 'reg, beta' }
    ],
    robust: [
      { name: '替换被解释变量', cmd: 'Replace Y' },
      { name: '替换核心解释变量', cmd: 'Replace X' },
      { name: '改变样本容量 (子样本)', cmd: 'Sub-sample' },
      { name: '缩尾处理 (Winsorize 1%)', cmd: 'winsor2' },
      { name: '解释变量滞后一期', cmd: 'L.X' },
      { name: '改变聚类层级 (Cluster)', cmd: 'vce(cluster)' },
      { name: '排除特殊样本 (直辖市等)', cmd: 'drop if' },
      { name: '增加控制变量 (敏感性)', cmd: 'Add Controls' },
      { name: '安慰剂检验 (随机化)', cmd: 'Placebo Test' },
      { name: '分位数回归', cmd: 'qreg' },
      { name: '变换模型设定', cmd: 'Model Spec' },
      { name: '调整时间窗口', cmd: 'Time Window' }
    ],
    endo: [
      { name: '工具变量法 (2SLS)', cmd: 'ivreg2' },
      { name: '系统 GMM (System GMM)', cmd: 'xtabond2' },
      { name: '差分 GMM (Diff GMM)', cmd: 'xtabond' },
      { name: '双重差分 (DID)', cmd: 'DID' },
      { name: '多期双重差分', cmd: 'Time-varying DID' },
      { name: '事件研究法 (Event Study)', cmd: 'Event Study' },
      { name: '倾向得分匹配 (PSM)', cmd: 'psmatch2' },
      { name: 'PSM-DID 结合', cmd: 'PSM-DID' },
      { name: 'Heckman 样本选择模型', cmd: 'heckman' },
      { name: '断点回归 (RDD)', cmd: 'rdrobust' },
      { name: '合成控制法 (SCM)', cmd: 'synth' },
      { name: 'Lewbel 异方差 IV', cmd: 'ivreg2 (lewbel)' }
    ],
    hetero: [
      { name: '分组回归检验', cmd: 'Group Regression' },
      { name: '交互项调节效应', cmd: 'Interaction Term' },
      { name: '组间系数差异检验', cmd: 'Chow/Suest' },
      { name: '经典中介效应 (三步法)', cmd: 'Baron & Kenny' },
      { name: 'Sobel/Bootstrap 中介', cmd: 'sgmediation' },
      { name: 'KHB 方法 (二值中介)', cmd: 'khb' },
      { name: '门槛效应模型', cmd: 'xthreg' },
      { name: 'Oaxaca-Blinder 分解', cmd: 'oaxaca' },
      { name: '分位数异质性', cmd: 'sqreg' },
      { name: '空间溢出效应 (SAR/SEM)', cmd: 'Spatial' },
      { name: '调节中介 (Moderated Mediation)', cmd: 'Mod-Med' },
      { name: '非线性效应 (U型)', cmd: 'c.X#c.X' }
    ]
  };

  // --- Actions ---

  // Step 1 -> 2: Get Variable Suggestions
  const fetchVariables = async () => {
    if (!topic || !apiKey) return;
    setLoading(true);

    try {
      const prompt = `
        研究主题: ${topic}
        研究领域: ${field}

        请作为一名资深经济学家，为该主题的 Stata 实证分析建议相关变量。
        请返回一个包含变量列表的 JSON 对象。
        
        规则:
        1. 建议 1 个主要被解释变量 (Y)。
        2. 建议 1 个主要核心解释变量 (X)。
        3. 建议 ${controlCount} 个控制变量 (Control)。
        4. 建议 ${mechCount} 个机制变量 (Mechanism)。
        5. 建议 ${heteroCount} 个异质性分组变量 (Hetero)。
        6. 建议 ${feCount} 个固定效应变量 (FixedEffect) (例如: Year, Industry, City)。
        7. 变量名 (name) 必须符合 Stata 格式 (小写英文，无空格，如 'gdp_growth', 'digital_idx')。
        8. 变量标签 (label) 请使用中文描述该变量的含义。
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              variables: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Stata 变量名 (英文)" },
                    label: { type: Type.STRING, description: "变量中文含义" },
                    role: { type: Type.STRING, enum: ["Y", "X", "Control", "Mechanism", "Hetero", "FixedEffect"] }
                  },
                  required: ["name", "label", "role"]
                }
              }
            }
          }
        }
      });
      
      const data = JSON.parse(response.text || "{}");
      if (data.variables) {
        setVariables(data.variables);
        setStep(2);
      }
    } catch (e) {
      console.error(e);
      alert("变量生成失败，请重试。");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Generate Stata Code for a specific section
  const generateStataCode = async (method: string, subType: string) => {
    setLoading(true);

    // Construct context from variables
    const y = variables.find(v => v.role === 'Y')?.name || "y";
    const x = variables.find(v => v.role === 'X')?.name || "x";
    const controls = variables.filter(v => v.role === 'Control').map(v => v.name).join(" ");
    const mechs = variables.filter(v => v.role === 'Mechanism').map(v => v.name).join(" ");
    const heteros = variables.filter(v => v.role === 'Hetero').map(v => v.name).join(" ");
    const fes = variables.filter(v => v.role === 'FixedEffect').map(v => v.name).join(" ");

    const prompt = `
      你是一名精通 Stata 19 的经济学专家。
      
      研究主题: ${topic}
      
      变量定义:
      - 被解释变量 (Y): ${y}
      - 核心解释变量 (X): ${x}
      - 控制变量: ${controls}
      - 机制变量: ${mechs}
      - 异质性变量: ${heteros}
      - 固定效应变量 (Fixed Effects): ${fes}

      任务: 请编写用于 ${method} (${subType}) 的 Stata 代码。
      
      关键要求:
      1. **假设数据已经导入并清洗完毕**：绝对不要生成 'clear', 'set obs', 'gen x = rnormal()' 或任何生成虚拟数据的代码。
      2. **直接写分析命令**：直接从数据声明或 global 定义开始，然后写 estimation commands。
      3. 必须使用上面提供的确切变量名。
      4. 如果是回归分析 (reghdfe/xtreg)，请正确使用固定效应变量 (absorb ${fes})。
      5. 使用标准的计量经济学命令 (如 reghdfe, ivreg2, esttab, sum, sgmediation 等)。
      6. 代码中必须包含清晰的中文注释 (以 * 开头)，解释每一步的经济学含义。
      7. 如果是回归分析，请包含 'esttab' 或 'outreg2' 命令来导出结果。
      8. 仅返回纯文本代码，不要包含 markdown 的反引号。
      9. 如果涉及"安慰剂检验"，请提供 permutation 代码框架或随机化处理变量的循环代码框架，不要生成假数据，而是对现有数据进行随机操作。
    `;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const code = response.text;
      
      const newSection: CodeSection = {
        title: method,
        code: code,
        explanation: `Generated code for ${method}.`
      };

      setGeneratedContent(prev => ({
        ...prev,
        [activeTab]: [newSection, ...prev[activeTab]]
      }));

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // --- Render Components ---

  const Header = () => (
    <header className="flex items-center justify-between px-4 py-2 text-white shadow-md shrink-0" style={{ backgroundColor: STATA_BLUE }}>
      <div className="flex items-center gap-3">
        <div className="bg-white text-blue-900 p-1 rounded font-bold text-xs font-mono">StATA</div>
        <span className="font-semibold tracking-wide text-sm">StataGen 19 / SE (中文版)</span>
      </div>
      <div className="flex gap-4 text-xs text-blue-100">
        <span className="flex items-center gap-1"><FileText size={14}/> 文件(File)</span>
        <span className="flex items-center gap-1"><Settings size={14}/> 编辑(Edit)</span>
        <span className="flex items-center gap-1"><Database size={14}/> 数据(Data)</span>
        <span className="flex items-center gap-1"><BarChart3 size={14}/> 图形(Graphics)</span>
        <span className="flex items-center gap-1"><Sigma size={14}/> 统计(Statistics)</span>
      </div>
    </header>
  );

  const getRoleLabel = (role: string) => {
      switch(role) {
          case 'Y': return '被解释变量 (Dependent Variable)';
          case 'X': return '核心解释变量 (Independent Variable)';
          case 'Control': return '控制变量 (Control Variables)';
          case 'Mechanism': return '机制变量 (Mechanism)';
          case 'Hetero': return '异质性变量 (Heterogeneity)';
          case 'FixedEffect': return '固定效应变量 (Fixed Effects)';
          default: return role;
      }
  }

  // Step 1: Topic Selection
  if (step === 1) {
    return (
      <div className="h-screen flex flex-col">
        <Header />
        <div className="flex-1 bg-gray-100 flex items-center justify-center p-4 overflow-auto">
          <div className="bg-white w-full max-w-2xl rounded-lg shadow-xl border border-gray-200 overflow-hidden my-4">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center gap-2">
              <Cpu className="text-blue-700" />
              <h2 className="text-lg font-semibold text-gray-800">新建项目向导 (New Project Wizard)</h2>
            </div>
            
            <div className="p-8 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">研究主题 / 题目</label>
                <input 
                  type="text" 
                  className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                  placeholder="例如：数字经济发展对城市碳排放的影响"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">研究领域</label>
                <select 
                  className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                >
                  <option>发展经济学 (Development Economics)</option>
                  <option>劳动经济学 (Labor Economics)</option>
                  <option>公司金融 (Corporate Finance)</option>
                  <option>环境经济学 (Environmental Economics)</option>
                  <option>宏观经济学 (Macroeconomics)</option>
                  <option>国际贸易 (International Trade)</option>
                  <option>卫生经济学 (Health Economics)</option>
                  <option>区域经济学 (Regional Economics)</option>
                </select>
              </div>

              {/* Advanced Settings for Counts */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                    <SlidersHorizontal size={14} /> 控制变量数
                  </label>
                  <input 
                    type="number" 
                    min="1" 
                    max="20"
                    className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                    value={controlCount}
                    onChange={(e) => setControlCount(Number(e.target.value))}
                  />
                </div>
                <div>
                   <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                    <Anchor size={14} /> 固定效应变量数
                  </label>
                  <input 
                    type="number" 
                    min="0" 
                    max="5"
                    className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                    value={feCount}
                    onChange={(e) => setFeCount(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                    <Workflow size={14} /> 机制变量数
                  </label>
                  <input 
                    type="number" 
                    min="1" 
                    max="5"
                    className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                    value={mechCount}
                    onChange={(e) => setMechCount(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                    <Layers size={14} /> 异质性变量数
                  </label>
                  <input 
                    type="number" 
                    min="0" 
                    max="5"
                    className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                    value={heteroCount}
                    onChange={(e) => setHeteroCount(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="bg-blue-50 p-4 rounded-md text-sm text-blue-800 border border-blue-100">
                <p className="flex items-start gap-2">
                   <BookOpen size={16} className="mt-0.5 flex-shrink-0"/>
                   系统将自动推荐 {controlCount} 个控制变量、{mechCount} 个机制变量、{heteroCount} 个异质性变量和 {feCount} 个固定效应变量。
                </p>
              </div>
              
              <button 
                onClick={fetchVariables}
                disabled={!topic || loading}
                className={`w-full py-3 rounded font-medium flex items-center justify-center gap-2 text-white transition-all ${loading ? 'bg-gray-400' : 'bg-blue-700 hover:bg-blue-800 shadow-lg'}`}
              >
                {loading ? <RefreshCw className="animate-spin" /> : <ArrowRight />}
                {loading ? "正在分析文献与变量..." : "下一步：智能推荐变量"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Variable Review
  if (step === 2) {
    return (
      <div className="h-screen flex flex-col">
        <Header />
        {/* 
           Change: Added 'overflow-hidden' to parent to prevent body scroll 
           Added 'items-start' and 'p-6' for positioning
        */}
        <div className="flex-1 bg-gray-100 p-6 flex justify-center items-start overflow-hidden">
          
          {/* 
             Change: Added 'flex flex-col max-h-full' to card 
             This makes the card take up available space but not overflow parent 
          */}
          <div className="w-full max-w-5xl bg-white rounded-lg shadow-lg border border-gray-200 flex flex-col max-h-full">
            
            {/* Header: shrink-0 to stay fixed */}
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 flex-shrink-0 rounded-t-lg">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Variable className="text-blue-600" /> 变量定义 (Variable Definition)
              </h2>
              <span className="text-xs text-gray-500 bg-white border px-2 py-1 rounded">Step 2/3</span>
            </div>

            {/* Content: flex-1 and overflow-y-auto to scroll internally */}
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              <p className="text-sm text-gray-600 mb-6">请检查并编辑 AI 建议的变量。确认后的变量名将用于生成 Stata 代码。</p>

              <div className="grid gap-6">
                {["Y", "X", "Control", "Mechanism", "Hetero", "FixedEffect"].map((role) => {
                  const roleVars = variables.filter(v => v.role === role);
                  if (roleVars.length === 0) return null;

                  return (
                    <div key={role} className="space-y-2">
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider border-b pb-1 sticky top-0 bg-white z-10 py-1">{getRoleLabel(role)}</h3>
                      {roleVars.map((v, idx) => (
                        <div key={idx} className="flex gap-3 items-center">
                          <div className="w-40 flex-shrink-0">
                             <input 
                              value={v.name}
                              onChange={(e) => {
                                  const newVars = [...variables];
                                  const index = newVars.findIndex(item => item === v);
                                  newVars[index].name = e.target.value;
                                  setVariables(newVars);
                              }}
                              className="w-full p-2 text-sm font-mono border border-gray-300 rounded bg-gray-50 text-blue-800 focus:border-blue-500 outline-none"
                              placeholder="变量名"
                             />
                          </div>
                          <div className="flex-1">
                             <input 
                              value={v.label}
                              onChange={(e) => {
                                  const newVars = [...variables];
                                  const index = newVars.findIndex(item => item === v);
                                  newVars[index].label = e.target.value;
                                  setVariables(newVars);
                              }}
                              className="w-full p-2 text-sm border border-gray-300 rounded focus:border-blue-500 outline-none"
                              placeholder="变量中文描述"
                             />
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Footer: shrink-0 to stay fixed */}
            <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 flex-shrink-0 rounded-b-lg">
               <button 
                 onClick={() => setStep(1)}
                 className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
               >
                 返回修改
               </button>
               <button 
                 onClick={() => setStep(3)}
                 className="px-6 py-2 bg-blue-700 text-white rounded hover:bg-blue-800 text-sm font-medium flex items-center gap-2"
               >
                 <Terminal size={16} /> 初始化 Stata 环境
               </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 3: Main Interface
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-100">
      <Header />
      
      {/* Toolbar */}
      <div className="bg-white border-b border-gray-300 px-2 py-1 flex gap-2 shadow-sm">
        <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><Save size={18}/></button>
        <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><Play size={18}/></button>
        <div className="w-px bg-gray-300 mx-1"></div>
        <span className="text-xs text-gray-500 self-center px-2 font-mono">当前项目: {topic.length > 20 ? topic.substring(0, 20) + '...' : topic}</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar: Variables */}
        <aside className="w-64 bg-white border-r border-gray-300 flex flex-col">
          <div className="p-2 bg-gray-50 border-b font-semibold text-xs text-gray-700 flex justify-between items-center">
            <span>变量列表 (Variables)</span>
            <Download size={14} className="text-gray-400 cursor-pointer hover:text-gray-600"/>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
             {variables.map((v, i) => (
               <div key={i} className="flex items-center gap-2 text-sm p-1 hover:bg-blue-50 rounded cursor-pointer group">
                  <span className={`w-2 h-2 flex-shrink-0 rounded-full ${v.role === 'Y' ? 'bg-red-500' : v.role === 'X' ? 'bg-blue-500' : v.role === 'FixedEffect' ? 'bg-purple-500' : 'bg-gray-400'}`}></span>
                  <span className="font-mono font-medium text-gray-800">{v.name}</span>
                  <span className="text-xs text-gray-400 truncate group-hover:text-gray-600" title={v.label}>{v.label}</span>
               </div>
             ))}
          </div>
          <div className="p-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 font-mono">
            内存: 128k
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 bg-gray-50">
          
          {/* Tabs */}
          <div className="flex border-b border-gray-300 bg-white">
             {[
               { id: 'basic', label: '1. 基础分析', icon: <Database size={14}/> },
               { id: 'benchmark', label: '2. 基准回归', icon: <BarChart3 size={14}/> },
               { id: 'robust', label: '3. 稳健性检验', icon: <CheckCircle2 size={14}/> },
               { id: 'endo', label: '4. 内生性分析', icon: <GitBranch size={14}/> },
               { id: 'hetero', label: '5. 异质性/机制', icon: <Layers size={14}/> },
             ].map(tab => (
               <button
                 key={tab.id}
                 onClick={() => setActiveTab(tab.id)}
                 className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-r border-gray-200 transition-colors ${
                   activeTab === tab.id 
                   ? 'bg-gray-100 text-blue-700 border-b-2 border-b-blue-700' 
                   : 'text-gray-600 hover:bg-gray-50'
                 }`}
               >
                 {tab.icon} {tab.label}
               </button>
             ))}
          </div>

          {/* Action Bar within Tab (Grid Layout for many options) */}
          <div className="p-4 bg-white border-b border-gray-200 shadow-sm">
            <div className="text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider flex items-center gap-1">
              <Zap size={12} /> 可用方法 (Available Methods)
            </div>
            <div className="grid grid-cols-4 gap-2">
              {analysisMethods[activeTab]?.map((method, idx) => (
                 <button 
                  key={idx}
                  onClick={() => generateStataCode(method.name, method.cmd)} 
                  className="px-3 py-2 bg-white border border-gray-300 rounded hover:bg-blue-50 hover:border-blue-300 text-sm text-gray-700 text-left truncate transition-colors flex flex-col gap-0.5 group"
                  title={method.name}
                 >
                   <span className="font-medium group-hover:text-blue-800">{method.name}</span>
                   <span className="text-[10px] text-gray-400 font-mono group-hover:text-blue-400">{method.cmd}</span>
                 </button>
              ))}
            </div>
          </div>

          {/* Code Output Area */}
          <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
             {loading && (
               <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                  <RefreshCw className="animate-spin mb-2 text-blue-600"/>
                  <span className="text-sm">正在生成 Stata 代码...</span>
               </div>
             )}
             
             {!loading && generatedContent[activeTab].length === 0 && (
               <div className="text-center text-gray-400 mt-20">
                  <Terminal size={48} className="mx-auto mb-4 opacity-20"/>
                  <p>请从上方选择一种方法，生成 {activeTab === 'basic' ? '基础分析' : activeTab === 'benchmark' ? '基准回归' : activeTab === 'robust' ? '稳健性检验' : activeTab === 'endo' ? '内生性分析' : '异质性与机制'} 代码。</p>
               </div>
             )}

             {generatedContent[activeTab].map((section, idx) => (
               <div key={idx} className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-px flex-1 bg-gray-300"></div>
                    <span className="text-xs font-bold text-gray-500 uppercase">{section.title}</span>
                    <div className="h-px flex-1 bg-gray-300"></div>
                  </div>
                  <StataCodeBlock code={section.code} />
               </div>
             ))}
          </div>

          {/* Footer Status Bar */}
          <div className="bg-white border-t border-gray-300 px-2 py-1 text-xs text-gray-500 font-mono flex justify-between">
             <span>就绪 (Ready)</span>
             <span>Ln 1, Col 1</span>
          </div>

        </main>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);