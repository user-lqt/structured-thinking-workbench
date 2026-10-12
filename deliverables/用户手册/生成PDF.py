"""将两份 Markdown 指南转换为 TeX，并用本机 XeLaTeX 编译。

运行：python 生成PDF.py
可用 --tex 指定 xelatex 可执行文件，--source-only 只更新 TeX。
"""
from pathlib import Path
import argparse
import re
import subprocess

ROOT = Path(__file__).resolve().parent
TITLES = {"用户手册": "使用与操作", "运维指南": "安装与维护"}


def escape(text):
    mapping = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$",
               "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}",
               "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}
    return "".join(mapping.get(ch, ch) for ch in text)


def inline(text):
    chunks = re.split(r"(`[^`]+`|\*\*[^*]+\*\*)", text)
    output = []
    for chunk in chunks:
        if chunk.startswith("`") and chunk.endswith("`"):
            code = chunk[1:-1]
            if code.startswith("http"):
                output.append(r"{\def\UrlBreaks{\do\/}\path{" + code + r"}}")
            else:
                output.append(r"\path{" + code + "}")
        elif chunk.startswith("**") and chunk.endswith("**"):
            output.append(r"\textbf{" + inline(chunk[2:-2]) + "}")
        else:
            output.append(escape(chunk))
    return "".join(output)


def table(rows):
    count = len(rows[0])
    widths = [0.28, 0.72] if count == 2 else [0.19, 0.43, 0.38]
    available = r"\dimexpr\linewidth-" + str(2 * count) + r"\tabcolsep\relax"
    spec = "".join(r">{\raggedright\arraybackslash}p{" + str(w) + "\\dimexpr" +
                   r"\linewidth-" + str(2 * count) + r"\tabcolsep\relax}" for w in widths)
    head = " & ".join(r"\textbf{" + inline(cell) + "}" for cell in rows[0]) + r" \\"
    body = [r"\begingroup\small\setlength{\tabcolsep}{5pt}\renewcommand{\arraystretch}{1.28}",
            r"\begin{longtable}{" + spec + "}", r"\toprule", head, r"\midrule\endfirsthead",
            r"\toprule", head, r"\midrule\endhead", r"\bottomrule\endfoot"]
    for row in rows[1:]:
        body.append(" & ".join(inline(cell) for cell in row) + r" \\")
    body += [r"\end{longtable}\endgroup"]
    return "\n".join(body)


def convert(markdown):
    lines = markdown.splitlines()
    out = []
    section = 0
    i = 1  # 第一行标题由版式模板提供
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith("```"):
            block = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                block.append(lines[i])
                i += 1
            out += [r"\Needspace{" + str(len(block) + 3) + r"\baselineskip}",
                    r"\begin{Verbatim}[fontsize=\small,breaklines=true,breakanywhere=true,frame=single,rulecolor=\color{Rule},framesep=7pt]",
                    "\n".join(block), r"\end{Verbatim}"]
        elif line.startswith("### "):
            out.append(r"\Needspace{4\baselineskip}\subsection*{" + inline(line[4:]) + "}")
        elif line.startswith("## "):
            section += 1
            title = re.sub(r"^\d+\.\s*", "", line[3:])
            out.append(r"\Needspace{10\baselineskip}\section{" + inline(title) + r"}\label{sec:" + str(section) + "}")
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-+:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            out.append(table(rows))
            continue
        elif line.startswith("!["):
            match = re.fullmatch(r"!\[(.*?)\]\((.*?)\)", line)
            caption, target = match.groups()
            out.append(r"\begin{center}\includegraphics[width=\linewidth,height=0.28\textheight,keepaspectratio]{" + target + "}" +
                       r"\par\vspace{3pt}{\small\color{Muted}" + inline(caption) + r"}\end{center}")
        elif re.match(r"\d+\. ", line):
            start = re.match(r"(\d+)\. ", line).group(1)
            out.append(r"\begin{enumerate}[start=" + start + "]")
            while i < len(lines) and re.match(r"\d+\. ", lines[i].strip()):
                out.append(r"\item " + inline(re.sub(r"^\d+\. ", "", lines[i].strip())))
                i += 1
            out.append(r"\end{enumerate}")
            continue
        else:
            para = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||!\[|```|\d+\. )", lines[i].strip()):
                para.append(lines[i].strip())
                i += 1
            out.append(inline(" ".join(para)) + "\n")
            continue
        i += 1
    return "\n\n".join(out)


PREAMBLE = r"""\documentclass[UTF8,fontset=windows,zihao=-4,a4paper]{ctexart}
\usepackage[top=20mm,bottom=20mm,left=22mm,right=22mm]{geometry}
\usepackage{graphicx,xcolor,array,longtable,booktabs,enumitem,fancyhdr,hyperref,fvextra,needspace,xurl}
\definecolor{Green}{HTML}{173D35}
\definecolor{Muted}{HTML}{61766D}
\definecolor{Rule}{HTML}{D8E3DC}
\setmainfont{TeX Gyre Termes}
\setmonofont{Consolas}
\hypersetup{colorlinks=true,linkcolor=Green,urlcolor=Green,bookmarksnumbered=true,pdfauthor={校园活动工作台小组},pdftitle={校园活动工作台 - TITLE}}
\urlstyle{tt}
\Urlmuskip=0mu plus 1mu
\setlength{\parindent}{0pt}
\setlength{\parskip}{4.5pt}
\linespread{1.15}
\setlist[enumerate]{leftmargin=1.8em,itemsep=3pt,topsep=4pt,parsep=0pt}
\setlength{\LTpre}{5pt}\setlength{\LTpost}{7pt}
\ctexset{section={format=\Large\bfseries\color{Green},beforeskip=16pt,afterskip=7pt},subsection={format=\normalsize\bfseries\color{Green},beforeskip=10pt,afterskip=4pt}}
\pagestyle{fancy}\fancyhf{}
\fancyhead[L]{\small\color{Muted}校园活动工作台}
\fancyhead[R]{\small\color{Muted}TITLE}
\fancyfoot[L]{\footnotesize\color{Muted}v1.0 正式版 · 2026.10.12}
\fancyfoot[R]{\small\color{Green}\thepage}
\setlength{\headheight}{16pt}
\renewcommand{\headrulewidth}{0.3pt}
\renewcommand{\footrulewidth}{0pt}
\raggedbottom
\begin{document}
{\small\color{Muted}校园活动工作台 / SUBTITLE}\par\vspace{4pt}
{\huge\bfseries\color{Green}TITLE}\par\vspace{5pt}
{\color{Green}\rule{\linewidth}{1.2pt}}\par
BODY
\end{document}
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tex", default="C:/texlive/2025/bin/windows/xelatex.exe")
    parser.add_argument("--source-only", action="store_true")
    args = parser.parse_args()
    build = ROOT / "build"
    build.mkdir(exist_ok=True)
    for title, subtitle in TITLES.items():
        content = (ROOT / (title + ".md")).read_text(encoding="utf-8")
        source = PREAMBLE.replace("SUBTITLE", subtitle).replace("TITLE", title).replace("BODY", convert(content))
        texfile = ROOT / (title + ".tex")
        texfile.write_text(source, encoding="utf-8")
        if args.source_only:
            continue
        for _ in range(2):
            result = subprocess.run([args.tex, "-interaction=nonstopmode", "-halt-on-error",
                                     "-output-directory=" + str(build), texfile.name],
                                    cwd=ROOT, capture_output=True, text=True, errors="replace")
            if result.returncode:
                print(result.stdout[-8000:])
                raise SystemExit(result.returncode)
        (ROOT / (title + ".pdf")).write_bytes((build / (title + ".pdf")).read_bytes())
        print(title + "：PDF 编译完成")


if __name__ == "__main__":
    main()
