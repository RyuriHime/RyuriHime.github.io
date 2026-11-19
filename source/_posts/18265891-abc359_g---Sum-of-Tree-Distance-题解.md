---
title: abc359_g - Sum of Tree Distance 题解
date: '2024-06-24 21:32:00'
categories:
- 题解
tags:
- OI 时期
permalink: /p/18265891/
description: 这是 P4103 大工程 的严格弱化版。
cover: /images/covers/solution.svg
top_img: /images/banner.svg
toc: true
mathjax: true
---

### **G - Sum of Tree Distance**

> 给你一棵有 \\(N\\) 个顶点的树。 \\(i\\) -th 边双向连接顶点 \\(u _ i\\) 和 \\(v _ i\\) 。
>
> 每个点有颜色 \\(A=(A _ 1,\\ldots,A _ N)\\) 。
>
> 定义 \\(f(i,j)\\) 如下：
>
> - 如果是 \\(A _ i = A _ j\\) ，那么 \\(f(i,j)\\) 就是从顶点 \\(i\\) 移动到顶点 \\(j\\) 所需的最小边数。如果是 \\(A _ i \\neq A _ j\\) ，那么就是 \\(f(i,j) = 0\\) 。
>
> 计算下面表达式的值：
>
> \[\displaystyle \sum _ {i=1}^{N-1}\sum _ {j=i+1}^N f(i,j)
> \]

这是 [P4103 大工程](https://www.luogu.com.cn/problem/P4103) 的严格弱化版。

可以对每种 \\(A_i\\) 分开算，题目转化为了每次给出一个点集，点集大小之和为 \\(n\\)，求点集中点两两距离和。

对点集建立虚树，然后在虚树上 dp。

设 \\(g_u\\) 表示以 \\(u\\) 为根的子树内所有当前颜色的点到根的距离和，\\(siz_u\\) 表示 \\(u\\) 子树大小。每次将一个子树 \\(v\\) 和当前子树合并。

对于两个点，如果它们在 \\(u\\) 的两个不同子树内，那么它们的 \\(\\operatorname{lca}\\) 为 \\(u\\)。

注意到 \\(g_u\\) 和 \\(g_v\\) 维护了一堆链的长度和，\\(u\\) 和 \\(v\\) 为端点的链拼上边 \\((u, v)\\) 就得到所有经过 \\(u\\) 的路径了。

设 \\(w\\) 为虚树上边 \\((u, v)\\) 的长度。然后容易写出状态转移方程：

\[\begin {aligned}
g_u &\leftarrow g_u + g_v + siz_v \cdot w \\
siz_u &\leftarrow siz_u + siz_v \\
ans &\leftarrow ans + (g_u + siz_u \cdot w) \cdot siz_v + g_v \cdot siz_u
\end {aligned}
\]

直接 dp 即可。

设 \\(C_i\\) 表示颜色为 \\(i\\) 的节点数量。对于每种颜色，建虚树的复杂度是排序和求 \\(\\operatorname{lca}\\) 的 \\(O(C_i \\log C_i)\\)，dp 是 \\(O(C_i)\\) 的。而 \\(\\sum C_i = n\\)。

所以总时间复杂度是 \\(O(n \\log n)\\)。

如果用基数排序并且用 \\(O(n) - O(1)\\) 的 \\(\\operatorname{lca}\\)，那么应该是可以优化到 \\(O(n)\\) 的。

```cpp
#include<iostream>
#include<fstream>
#include<algorithm>
#include<vector>
using namespace std;
namespace azus{
	int n;
	int col[400005];
	vector<int> que[400005];
	vector<int> edge[400005];
	int fa[400005], siz[400005], son[400005], dep[400005];
	int dfs1(int u, int ft){
		fa[u] = ft, siz[u] = 1, dep[u] = dep[ft] + 1;
		for(int i = 0, v; i < edge[u].size(); i ++){
			v = edge[u][i];
			if(v == ft) continue;
			dfs1(v, u);
			siz[u] += siz[v];
			if(siz[v] > siz[son[u]]) son[u] = v;
		}
		return 0;
	}
	int dfn[400005], top[400005], rnk[400005], tim;
	int dfs2(int u, int ft, int tp){
		dfn[u] = ++ tim, rnk[tim] = u, top[u] = tp;
		if(son[u] != 0)
			dfs2(son[u], u, tp);
		for(int v : edge[u]){
			if(v == ft || v == son[u]) continue;
			dfs2(v, u, v);
		}
		return 0;
	}
	int getlca(int u, int v){
		if(dep[top[u]] <= dep[top[v]]) swap(u, v);
		if(top[u] == top[v]){
			if(dep[u] > dep[v]) return v;
			return u;
		}
		return getlca(fa[top[u]], v);
	}
	int a[400005], tot, num;
	bool cmp(int u, int v){
		return dfn[u] < dfn[v];
	}
	bool vis[400005];
	vector<int> edg[400005];
	vector<int> vl[400005];
	long long g[400005];
	int sz[400005];
	long long ret;
	int dfs(int u){
		if(vis[u]) sz[u] ++;
		for(int i = 0, v, w; i < edg[u].size(); i ++){
			v = edg[u][i], w = vl[u][i];
			dfs(v);
			ret += 1ll * (g[u] + 1ll * sz[u] * w) * sz[v] + 1ll * g[v] * sz[u];
			g[u] += g[v] + 1ll * sz[v] * w;
			sz[u] += sz[v];
		}
		return 0;
	}
	signed main(){
		cin >> n;
		for(int i = 1, u, v; i < n; i ++)
			cin >> u >> v, edge[u].push_back(v), edge[v].push_back(u);
		for(int i = 1, x; i <= n; i ++)
			cin >> x, que[x].push_back(i);
		dfs1(1, 0), dfs2(1, 0, 1);
		long long ans = 0;
		for(int T = 1; T <= n; T ++){
			tot = que[T].size();
			for(int i = 1; i <= tot; i ++)
				a[i] = que[T][i - 1], vis[a[i]] = 1;
			sort(a + 1, a + tot + 1, cmp);
			num = tot;
			for(int i = 2; i <= num; i ++){
				int lca = getlca(a[i], a[i - 1]);
				if(lca != a[i] && lca != a[i - 1])
					a[++ tot] = lca;
			}
			sort(a + 1, a + tot + 1);
			tot = unique(a + 1, a + tot + 1) - (a + 1);
			sort(a + 1, a + tot + 1, cmp);
			for(int i = 2; i <= tot; i ++){
				int lca = getlca(a[i], a[i - 1]);
				edg[lca].push_back(a[i]);
				vl[lca].push_back(dep[a[i]] - dep[lca]);
			}
			ret = 0;
			dfs(a[1]);
			ans += ret;
			for(int i = 1; i <= tot; i ++)
				vis[a[i]] = 0, edg[a[i]].clear(), vl[a[i]].clear(), g[a[i]] = sz[a[i]] = 0;
		}
		cout << ans;
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
