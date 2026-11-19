---
title: AzusidNya人傻常数大
date: '2024-06-07 20:44:00'
categories:
- 杂谈
tags:
- OI 时期
permalink: /p/18237840/
description: 看过《具体数学》的话，很容易看出前缀和就是其生成函数卷积上 \\((1 - x) ^ {-1}\\)，差分就是卷上 \\((1 - x)\\)。
cover: /images/covers/misc.svg
top_img: /images/banner.svg
toc: true
mathjax: true
---

> AzusidNya 17分钟前：
>
> 多项式快速幂 \\(n\\log n\\) 跑 \\(1e5\\) 跑了 \\(4\\) 秒，乐
>
> - 删除

> ### P5488 差分与前缀和
>
> 给定一个长为 \\(n\\) 的序列 \\(a\\)，求出其 \\(k\\) 阶差分或前缀和。  
> 结果的每一项都需要对 \\(1004535809\\) 取模。
>
> \\(1 \\le n \\le 10^5\\)  
> \\(0 \\le a_i \\le 10^9\\)  
> \\(1\\le k \\le 10^{2333}, k \\not \\equiv 0 \\pmod{1004535809}\\)

看过《具体数学》的话，很容易看出前缀和就是其生成函数卷积上 \\((1 - x) ^ {-1}\\)，差分就是卷上 \\((1 - x)\\)。

当然这里也推一下吧。

\[\sum_{i} \left(\sum _{j = 0} ^{i}a_j\right)x^i = \sum _i \sum _{u + v = i} a_ux^u \times x^v
\]

定义 \\(A = \\sum _{i} a_ix^i\\)，\\(B = \\sum _i x^i\\)。

\[\sum _i \sum _{u + v = i} a_ux^u \times x^v = A * B
\]

而

\[\sum _i x^i = (1 - x) ^{-1}
\]

所以很进行一次前缀和就是卷上 \\((1 - x) ^ {-1}\\)，而差分和前缀和是逆运算，所以只用卷上 \\((1 - x)\\)​ 就行了。

\\(n\\) 次前缀和就是卷上 \\((1 - x) ^ {-k}\\)，差分就是卷上 \\((1 - x)^k\\)​

之前做过多项式快速幂，知道这里这么大的 \\(k\\) 是可以直接对模数取模的。

多项式快速幂和多项式求逆拍上去，做完了（误

好吧 AzusidNya 推到这一步这么做了，然后就有了上面第一句话。

虽然时间复杂度是 \\(O(n \\log n)\\)​ 的，但是常数巨大。考虑优化，能卡常过去的可以无视下面的内容。

我们感觉 \\((1 - x)^k\\) 是很好看的，考虑不快速幂求出这个多项式的系数。

通过二项式定理把它展开，得到：

\[(1 - x) ^k = \sum _i (-1) ^i \binom ki x^i
\]

这个式子可以递推求出来。

具体来说：

\[\binom ki = \frac {k!}{i!(k - i)!} = \frac {k - i + 1}{i} \frac {k!}{(i - 1)!(k - i + 1)!} = \frac {k - i + 1}{i}\binom{k}{i - 1}
\]

然后我们可以把系数搞出来。

接下来求前缀和完全可以套一个多项式求逆。这样已经不会 TLE 了。

但是其实前缀和也能一样地用递推求出所有系数。

找回上面的式子：

\[(1 - x) ^k = \sum _i (-1) ^i \binom ki x^i
\]

这里用下降幂表示二项式系数：

\[\binom ki = \frac{k^{\underline i}}{i!}
\]

把 \\(-k\\) 代进去。

\[\begin {aligned}
(1 - x) ^ {-k} &= \sum _i (-1) ^i \binom {-k}i x^i \\
&= \sum _i (-1) ^i \frac {(-k) ^ {\underline i}}{i!} x^i \\
&= \sum _i (-1) ^ {2i} \frac {k + i - 1 ^ {\underline i}}{i!} x^i \\
&= \sum_i \binom {k + i - 1}{i} x^i
\end {aligned}
\]

这玩意也是可以递推的，和上面的推导方法差不多，这里懒得再推一遍了。

这两个多项式的系数递推完后直接卷积就行了，问题变成了 【模板】多项式乘法。

代码删除了 namespace Poly 部分，因为 \\(1000\\) 个人有 \\(1000\\) 个多项式板子。

```
#include<iostream>
#include<fstream>
#include<algorithm>
#include<vector>
#include<string>
#define int long long
using namespace std;

namespace azus{
	using namespace Poly;
	int n, opt;
	int k;
	string sk;
	poly a;
	int main(){
		cin >> n >> sk >> opt;
		for(int i = 0; i < sk.size(); i ++){
			k = 1ll * k * 10 % P;
			k += sk[i] - '0';
			k %= P;
		}
//		cout << k << "\n";
		for(int i = 0, x; i < n; i ++){
			cin >> x;
			a.push_back(x);
		}
		poly d;
		d.resize(n);
		d[0] = 1;
		if(opt == 0)
		for(int i = 1; i < n; i ++)
			d[i] = (d[i - 1] * ((P + k + i - 1) % P) % P) * Ksm(i, P - 2) % P;
		else{
			for(int i = 1; i < n; i ++)
				d[i] = ((P - d[i - 1]) * ((P + k - i + 1) % P) % P) * Ksm(i, P - 2) % P;
		}
//		polyOutput(d);
		a = convolution(a, d);
		a.resize(n);
		polyOutput(a);
		return 0;
	}
}
signed main(){
	ios::sync_with_stdio(0);
	cin.tie(0), cout.tie(0);
	int T = 1;
	while(T --) azus::main();
	return 0;
}
```
